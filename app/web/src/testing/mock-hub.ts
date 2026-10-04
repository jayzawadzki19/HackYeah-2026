type Emit = (type: string, data?: string) => void;

interface Source {
  readonly url: string;
  readonly emit: Emit;
}

const sources = new Set<Source>();

export const mockHub = {
  register(source: Source): () => void {
    sources.add(source);
    return () => sources.delete(source);
  },
  emit(user: string, type: string, payload: unknown): void {
    const url = `/api/users/${user}/stream`;
    const data = JSON.stringify(payload);
    for (const source of sources) {
      if (source.url === url) source.emit(type, data);
    }
  },
};
