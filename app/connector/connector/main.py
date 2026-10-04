"""CLI: `login`, `probe --date`, `backfill --days`, and `serve`."""

import argparse
import getpass
import logging
import sys
import threading
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime

from pydantic_settings import BaseSettings

from connector.config import ENV_FILE, ConfigError, ConnectorSettings, OpenWearablesSettings, load
from connector.garmin_client import (
    GarminAuthError,
    GarminConnectSource,
    GarminUnavailableError,
    login_interactively,
)
from connector.models import Stream
from connector.ow_client import OpenWearablesClient, OpenWearablesError
from connector.payload import iso_utc
from connector.probe import probe_report, write_probe
from connector.server import SyncService, make_server, run_poll_loop
from connector.state import CursorFileError
from connector.sync import Syncer, SyncResult

log = logging.getLogger(__name__)

_FAILURES = (
    ConfigError,
    CursorFileError,
    GarminAuthError,
    GarminUnavailableError,
    OpenWearablesError,
)


def _date_arg(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {value!r}") from None


def _days_arg(value: str) -> int:
    try:
        days = int(value)
    except ValueError:
        days = 0
    if days < 1:
        raise argparse.ArgumentTypeError("expected a positive number of days")
    return days


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="connector",
        description="Move your own Garmin Connect data into open-wearables.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Store a Garmin session in the token directory")
    probe = commands.add_parser("probe", help="Save one day of raw Garmin JSON and print a summary")
    probe.add_argument("--date", required=True, type=_date_arg, help="Calendar day, YYYY-MM-DD")
    backfill = commands.add_parser("backfill", help="Push the last N local days, including today")
    backfill.add_argument("--days", required=True, type=_days_arg)
    commands.add_parser("serve", help="Poll Garmin and serve POST /sync and GET /health")
    return parser


def _load[T: BaseSettings](kind: type[T]) -> T:
    return load(kind, ENV_FILE if ENV_FILE.is_file() else None)


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for name in ("garminconnect", "httpx", "httpcore", "urllib3"):
        logging.getLogger(name).setLevel(logging.WARNING)


def _prompt_secret(label: str) -> str:
    return getpass.getpass(f"{label}: ")


def run_login(settings: ConnectorSettings, *, secret: Callable[[str], str] | None = None) -> None:
    """Asks for email, password, and MFA without echoing them. Tokens stay in the token directory."""
    ask = _prompt_secret if secret is None else secret
    email = ask("Garmin email").strip()
    password = ask("Garmin password")
    if not email or not password:
        raise GarminAuthError("Garmin email and password are required")

    def prompt_mfa() -> str:
        return ask("Garmin MFA code").strip()

    login_interactively(settings.garmin_token_dir, email, password, prompt_mfa)
    print(f"Garmin session stored in {settings.garmin_token_dir}")


def run_probe(settings: ConnectorSettings, day: date) -> None:
    source = GarminConnectSource(settings.garmin_token_dir)
    bundle = source.fetch_day(day)
    try:
        device = source.last_used_device()
    except (GarminAuthError, GarminUnavailableError) as error:
        log.error("Could not read the last used device: %s", error)
        device = None
    target = write_probe(bundle, device, settings.probe_dir)
    print("\n".join(probe_report(bundle, device)))
    print(f"Raw JSON written to {target}")


def _client(ow: OpenWearablesSettings) -> OpenWearablesClient:
    return OpenWearablesClient(str(ow.ow_base_url), ow.ow_api_key.get_secret_value(), str(ow.ow_user_id))


def _syncer(settings: ConnectorSettings, client: OpenWearablesClient) -> Syncer:
    return Syncer(
        source=GarminConnectSource(settings.garmin_token_dir),
        pusher=client,
        cursor_path=settings.cursor_path,
        time_zone=settings.timezone,
        device_model=settings.garmin_device_model,
        clock=lambda: datetime.now(UTC),
    )


def _print_result(result: SyncResult) -> None:
    latest = iso_utc(result.latest_sample_at) if result.latest_sample_at else "none"
    print(f"Pushed {result.pushed_records} records; latest sample {latest}")
    for stream in Stream:
        count = result.per_stream.get(stream, 0)
        if count:
            print(f"  {stream.value}: {count}")


def run_backfill(settings: ConnectorSettings, ow: OpenWearablesSettings, days: int) -> None:
    with _client(ow) as client:
        _print_result(_syncer(settings, client).backfill(days))


def run_serve(settings: ConnectorSettings, ow: OpenWearablesSettings) -> None:
    with _client(ow) as client:
        service = SyncService(_syncer(settings, client).poll, clock=lambda: datetime.now(UTC))
        try:
            server = make_server(service, settings.host, settings.port, settings.connector_user)
        except OSError as error:
            where = f"{settings.host}:{settings.port}"
            raise ConfigError(f"Cannot listen on {where}: {error}") from error
        stop = threading.Event()
        poll = threading.Thread(
            target=run_poll_loop,
            kwargs={"service": service, "interval_s": settings.poll_interval_s, "stop": stop},
            name="garmin-poll",
            daemon=True,
        )
        log.info(
            "Listening on http://%s:%s for user %s; polling every %ss",
            settings.host,
            server.server_address[1],
            settings.connector_user,
            settings.poll_interval_s,
        )
        poll.start()
        try:
            server.serve_forever(poll_interval=0.5)
        except KeyboardInterrupt:
            log.info("Stopping")
        finally:
            stop.set()
            poll.join(timeout=5)
            server.server_close()


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(None if argv is None else list(argv))
    _configure_logging()
    try:
        settings = _load(ConnectorSettings)
        match args.command:
            case "login":
                run_login(settings)
            case "probe":
                run_probe(settings, args.date)
            case "backfill":
                run_backfill(settings, _load(OpenWearablesSettings), args.days)
            case "serve":
                run_serve(settings, _load(OpenWearablesSettings))
            case other:
                raise ConfigError(f"Unknown command {other}")
    except _FAILURES as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
