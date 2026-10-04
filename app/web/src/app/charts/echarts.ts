import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, CanvasRenderer]);

export { echarts };
