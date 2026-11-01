/** Modular ECharts bundle: only what the elevation chart needs. */
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  BrushComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, BrushComponent, CanvasRenderer]);

export { echarts };
export type { EChartsCoreOption } from 'echarts/core';
