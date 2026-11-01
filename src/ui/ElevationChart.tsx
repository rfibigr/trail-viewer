import { useEffect, useMemo, useRef } from 'react';
import type { AnalysisResult } from '../types';
import { segmentColor, type Theme } from './colors';
import { echarts, type EChartsCoreOption } from './echarts';
import {
  directionLabel,
  formatClock,
  formatDuration,
  formatElevation,
  formatGrade,
  formatKm,
  formatVerticalSpeed,
} from './format';
import {
  altitudeRange,
  fillStops,
  nearestIndex,
  segmentDrawStart,
  xValues,
  type ColorMode,
  type XMode,
} from './profile';

interface Props {
  result: AnalysisResult;
  xMode: XMode;
  colorMode: ColorMode;
  theme: Theme;
  /** Segment to emphasise (e.g. hovered table row). */
  highlightSegment: number | null;
  /** Called when the pointer moves onto a different segment, or leaves the chart (null). */
  onHoverSegment?: (index: number | null) => void;
}

const TOKENS = {
  light: {
    text: '#5d6575',
    axis: '#cfd4dc',
    grid: '#eceef2',
    line: '#1b2130',
    pointer: '#1b2130',
    band: 'rgba(27, 33, 48, 0.07)',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e1e4ea',
  },
  dark: {
    text: '#98a1b1',
    axis: '#3b4352',
    grid: '#252b35',
    line: '#eef1f6',
    pointer: '#eef1f6',
    band: 'rgba(255, 255, 255, 0.08)',
    tooltipBg: '#1a1f28',
    tooltipBorder: '#343b48',
  },
} as const;

export function ElevationChart({ result, xMode, colorMode, theme, highlightSegment, onHoverSegment }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const xs = useMemo(() => xValues(result.points, xMode), [result, xMode]);

  // Latest values for event handlers registered once.
  const latest = useRef({ xs, result, onHoverSegment, hovered: null as number | null });
  latest.current.xs = xs;
  latest.current.result = result;
  latest.current.onHoverSegment = onHoverSegment;

  useEffect(() => {
    const node = el.current!;
    const c = echarts.init(node, null, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);

    const report = (seg: number | null) => {
      if (latest.current.hovered === seg) return;
      latest.current.hovered = seg;
      latest.current.onHoverSegment?.(seg);
    };
    c.on('updateAxisPointer', (e: unknown) => {
      const info = (e as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo?.find((a) => a.axisDim === 'x');
      if (!info) return;
      const { xs: x, result: r } = latest.current;
      const i = nearestIndex(x, info.value);
      report(i >= 0 ? (r.points[i]?.segmentIndex ?? null) : null);
    });
    c.getZr().on('globalout', () => report(null));

    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  const option = useMemo<EChartsCoreOption>(() => {
    const t = TOKENS[theme];
    const { points, segments } = result;
    const stops = fillStops(result, xs, colorMode, theme);
    const [yMin, yMax, yStep] = altitudeRange(points);
    const isTime = xMode === 'time';

    const tooltipHtml = (x: number) => {
      const i = nearestIndex(xs, x);
      const p = points[i];
      if (!p) return '';
      const seg = segments[p.segmentIndex];
      const pointRows = `
        <div class="tt-sub">${formatKm(p.distance)} · ${formatDuration(p.movingTime)}</div>
        <div class="tt-grid">
          <span>Altitude</span><b>${formatElevation(p.altitude)}</b>
          <span>Vert. speed</span><b>${formatVerticalSpeed(p.verticalSpeed)}</b>
        </div>`;
      if (!seg) return `<div class="tt">${pointRows}</div>`;
      const color = segmentColor(seg, theme);
      const arrow = seg.direction === 'up' ? '▲' : seg.direction === 'down' ? '▼' : '▬';
      return `<div class="tt">
        <div class="tt-head"><i class="tt-key" style="background:${color}"></i>
          <span>${arrow} ${directionLabel(seg.direction)}</span>
          <span class="tt-muted">#${p.segmentIndex + 1} of ${segments.length}</span></div>
        <div class="tt-sub">${(seg.startDistance / 1000).toFixed(2)}–${formatKm(seg.endDistance)}
          <span class="tt-muted">(${formatKm(seg.endDistance - seg.startDistance)})</span></div>
        <div class="tt-grid">
          <span>Avg vert. speed</span><b>${formatVerticalSpeed(seg.avgVerticalSpeed)}</b>
          <span>Avg grade</span><b>${formatGrade(seg.avgGrade)}</b>
          <span>D+ / D−</span><b>${formatElevation(seg.gain)} / ${formatElevation(seg.loss)}</b>
          <span>Duration</span><b>${formatDuration(seg.duration)}</b>
        </div>
        <div class="tt-sep"></div>
        <div class="tt-label">At this point</div>
        ${pointRows}
      </div>`;
    };

    return {
      animation: false,
      grid: { left: 8, right: 16, top: 16, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: t.line, fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);',
        axisPointer: { type: 'line', snap: false, lineStyle: { color: t.pointer, width: 1, type: 'solid', opacity: 0.6 } },
        formatter: (params: unknown) => {
          const arr = params as { axisValue: number }[];
          return arr.length ? tooltipHtml(Number(arr[0].axisValue)) : '';
        },
      },
      xAxis: {
        type: 'value',
        min: 'dataMin',
        max: 'dataMax',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { lineStyle: { color: t.axis } },
        splitLine: { show: false },
        axisLabel: {
          color: t.text,
          hideOverlap: true,
          formatter: (v: number) => (isTime ? formatClock(v * 3600) : `${Number(v.toFixed(1))} km`),
        },
      },
      yAxis: {
        type: 'value',
        min: yMin,
        max: yMax,
        interval: yStep,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.text, formatter: (v: number) => `${v} m` },
      },
      series: [
        {
          id: 'profile',
          type: 'line',
          data: points.map((p, i) => [xs[i], p.altitude]),
          showSymbol: false,
          symbol: 'none',
          silent: true,
          emphasis: { disabled: true },
          lineStyle: { color: t.line, width: 1.25, opacity: 0.9 },
          areaStyle: {
            origin: 'start',
            opacity: 1,
            color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, global: false, colorStops: stops },
          },
          z: 2,
        },
        { id: 'hl', type: 'line', data: [], showSymbol: false, silent: true, z: 3 },
      ],
    };
  }, [result, xs, xMode, colorMode, theme]);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  // Highlight overlay: merged into the existing option so the profile isn't rebuilt.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const seg = highlightSegment != null ? result.segments[highlightSegment] : undefined;
    const t = TOKENS[theme];
    if (!seg) {
      c.setOption({ series: [{ id: 'hl', data: [], markArea: { data: [] } }] });
      return;
    }
    const from = segmentDrawStart(result.segments, highlightSegment!);
    const data: [number, number][] = [];
    for (let i = from; i <= seg.endIndex; i++) data.push([xs[i], result.points[i].altitude]);
    c.setOption({
      series: [
        {
          id: 'hl',
          data,
          showSymbol: false,
          lineStyle: { color: t.line, width: 3 },
          markArea: {
            silent: true,
            itemStyle: { color: t.band },
            data: [[{ xAxis: xs[from] }, { xAxis: xs[seg.endIndex] }]],
          },
        },
      ],
    });
  }, [highlightSegment, result, xs, theme, option]);

  return <div ref={el} className="chart" role="img" aria-label="Elevation profile coloured by vertical speed" />;
}
