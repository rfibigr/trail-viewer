import { useEffect, useMemo, useRef } from 'react';
import type { AnalysisResult } from '../types';
import { segmentColor, verticalSpeedColor, type Theme } from './colors';
import { echarts, type EChartsCoreOption } from './echarts';
import {
  directionLabel,
  formatClock,
  formatDuration,
  formatElevation,
  formatGrade,
  formatInt,
  formatKm,
  formatVerticalSpeed,
} from './format';
import { altitudeRange, fillStops, nearestIndex, segmentDrawStart, verticalSpeedRange, xValues, type XMode } from './profile';

export type IndexRange = [number, number];

interface Props {
  result: AnalysisResult;
  xMode: XMode;
  theme: Theme;
  /** Segment to emphasise (e.g. hovered table row). */
  highlightSegment: number | null;
  /** Called when the pointer moves onto a different segment, or leaves the chart (null). */
  onHoverSegment?: (index: number | null) => void;
  /** Selected point-index range, shaded on both graphs. */
  selection: IndexRange | null;
  /** Called with point indices after a drag-select, or null when the user clicks to dismiss. */
  onSelect?: (range: IndexRange | null) => void;
}

const TOKENS = {
  light: {
    text: '#5d6575',
    axis: '#cfd4dc',
    grid: '#eceef2',
    zero: '#8a92a0',
    line: '#1b2130',
    pointer: '#1b2130',
    band: 'rgba(27, 33, 48, 0.07)',
    sel: 'rgba(27, 33, 48, 0.12)',
    selEdge: 'rgba(27, 33, 48, 0.55)',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e1e4ea',
  },
  dark: {
    text: '#98a1b1',
    axis: '#3b4352',
    grid: '#252b35',
    zero: '#6f7888',
    line: '#eef1f6',
    pointer: '#eef1f6',
    band: 'rgba(255, 255, 255, 0.08)',
    sel: 'rgba(255, 255, 255, 0.13)',
    selEdge: 'rgba(255, 255, 255, 0.6)',
    tooltipBg: '#1a1f28',
    tooltipBorder: '#343b48',
  },
} as const;

/** Grid geometry shared by both graphs so their x axes line up exactly. */
const GRID_LEFT = 58;
const GRID_RIGHT = 14;

export function ElevationChart({ result, xMode, theme, highlightSegment, onHoverSegment, selection, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const xs = useMemo(() => xValues(result.points, xMode), [result, xMode]);

  // Latest values for event handlers registered once.
  const latest = useRef({ xs, result, onHoverSegment, onSelect, hovered: null as number | null });
  latest.current.xs = xs;
  latest.current.result = result;
  latest.current.onHoverSegment = onHoverSegment;
  latest.current.onSelect = onSelect;

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

    // Drag-select: the brush only captures the gesture; the selection is drawn as markAreas from props.
    c.on('brushEnd', (e: unknown) => {
      const area = (e as { areas?: { coordRange?: number[]; coordRanges?: number[][] }[] }).areas?.[0];
      const range = area?.coordRange ?? area?.coordRanges?.[0];
      c.dispatchAction({ type: 'brush', areas: [] });
      if (!range || range.length < 2) return;
      const { xs: x } = latest.current;
      const a = nearestIndex(x, Math.min(range[0], range[1]));
      const b = nearestIndex(x, Math.max(range[0], range[1]));
      if (b > a) latest.current.onSelect?.([a, b]);
    });
    // A plain click (no drag) on the plot dismisses the selection.
    let down: { x: number; y: number } | null = null;
    c.getZr().on('mousedown', (e) => {
      down = { x: e.offsetX, y: e.offsetY };
    });
    c.getZr().on('mouseup', (e) => {
      if (down && Math.hypot(e.offsetX - down.x, e.offsetY - down.y) < 4) latest.current.onSelect?.(null);
      down = null;
    });

    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  const option = useMemo<EChartsCoreOption>(() => {
    const t = TOKENS[theme];
    const { points, segments } = result;
    const stops = fillStops(points, xs, theme);
    const gradient = { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, global: false, colorStops: stops };
    const [yMin, yMax, yStep] = altitudeRange(points);
    const [vMin, vMax, vStep] = verticalSpeedRange(points);
    const isTime = xMode === 'time';
    const xLabel = (v: number) => (isTime ? formatClock(v * 3600) : `${Number(v.toFixed(1))} km`);

    const tooltipHtml = (x: number) => {
      const i = nearestIndex(xs, x);
      const p = points[i];
      if (!p) return '';
      const head = `
        <div class="tt-hero"><i class="tt-key" style="background:${verticalSpeedColor(p.verticalSpeed, theme)}"></i>
          <b>${formatVerticalSpeed(p.verticalSpeed)}</b></div>
        <div class="tt-grid">
          <span>Altitude</span><b>${formatElevation(p.altitude)}</b>
          <span>${formatKm(p.distance)}</span><b>${formatDuration(p.movingTime)}</b>
        </div>`;
      const seg = segments[p.segmentIndex];
      if (!seg) return `<div class="tt">${head}</div>`;
      const arrow = seg.direction === 'up' ? '▲' : seg.direction === 'down' ? '▼' : '▬';
      return `<div class="tt">${head}
        <div class="tt-sep"></div>
        <div class="tt-label"><i class="tt-key tt-key-sm" style="background:${segmentColor(seg, theme)}"></i>
          ${arrow} ${directionLabel(seg.direction)} · segment ${p.segmentIndex + 1}/${segments.length}</div>
        <div class="tt-sub">${(seg.startDistance / 1000).toFixed(2)}–${formatKm(seg.endDistance)}
          (${formatKm(seg.endDistance - seg.startDistance)}) · ${formatDuration(seg.duration)}</div>
        <div class="tt-grid">
          <span>Avg vert. speed</span><b>${formatVerticalSpeed(seg.avgVerticalSpeed)}</b>
          <span>Avg grade</span><b>${formatGrade(seg.avgGrade)}</b>
          <span>D+ / D−</span><b>${formatElevation(seg.gain)} / ${formatElevation(seg.loss)}</b>
        </div>
      </div>`;
    };

    const xAxisBase = {
      type: 'value',
      min: 'dataMin',
      max: 'dataMax',
      splitLine: { show: false },
    };

    return {
      animation: false,
      grid: [
        // outerBoundsMode 'none': never let label overflow shrink one grid, or the x axes would drift apart.
        { left: GRID_LEFT, right: GRID_RIGHT, top: 12, height: '61%', outerBoundsMode: 'none' },
        { left: GRID_LEFT, right: GRID_RIGHT, bottom: 26, height: '21%', outerBoundsMode: 'none' },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: t.line, fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);',
        axisPointer: { type: 'line', lineStyle: { color: t.pointer, width: 1, opacity: 0.6 } },
        formatter: (params: unknown) => {
          const arr = params as { axisValue: number }[];
          return arr.length ? tooltipHtml(Number(arr[0].axisValue)) : '';
        },
      },
      brush: {
        xAxisIndex: 'all',
        brushType: 'lineX',
        brushMode: 'single',
        transformable: false,
        removeOnClick: true,
        brushStyle: { color: t.sel, borderColor: t.selEdge, borderWidth: 1 },
        outOfBrush: { colorAlpha: 1 },
        throttleType: 'debounce',
        throttleDelay: 0,
      },
      xAxis: [
        {
          ...xAxisBase,
          gridIndex: 0,
          axisLine: { lineStyle: { color: t.axis } },
          axisTick: { show: false },
          axisLabel: { show: false },
        },
        {
          ...xAxisBase,
          gridIndex: 1,
          axisLine: { show: false, onZero: false },
          axisTick: { lineStyle: { color: t.axis } },
          axisLabel: { color: t.text, hideOverlap: true, alignMinLabel: 'left', alignMaxLabel: 'right', formatter: xLabel },
          axisPointer: { label: { show: false } },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          min: yMin,
          max: yMax,
          interval: yStep,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: t.grid } },
          axisLabel: { color: t.text, formatter: (v: number) => `${v} m` },
        },
        {
          type: 'value',
          gridIndex: 1,
          min: vMin,
          max: vMax,
          interval: vStep,
          name: 'm/h',
          nameLocation: 'end',
          nameGap: 6,
          nameTextStyle: { color: t.text, fontSize: 11, align: 'right', padding: [0, 6, 0, 0] },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: t.grid } },
          axisLabel: { color: t.text, formatter: (v: number) => (v > 0 ? `+${formatInt(v)}` : formatInt(v)) },
        },
      ],
      series: [
        {
          id: 'profile',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: points.map((p, i) => [xs[i], p.altitude]),
          showSymbol: false,
          symbol: 'none',
          silent: true,
          emphasis: { disabled: true },
          lineStyle: { color: t.line, width: 1.25, opacity: 0.9 },
          areaStyle: { origin: 'start', opacity: 1, color: gradient },
          z: 2,
        },
        { id: 'hl', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: [], showSymbol: false, silent: true, z: 3 },
        {
          id: 'vs',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: points.map((p, i) => [xs[i], p.verticalSpeed]),
          showSymbol: false,
          symbol: 'none',
          silent: true,
          emphasis: { disabled: true },
          lineStyle: { color: t.line, width: 1, opacity: 0.75 },
          areaStyle: { origin: 0, opacity: 1, color: gradient },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: t.zero, width: 1, type: 'solid' },
            data: [{ yAxis: 0 }],
          },
          z: 2,
        },
      ],
    };
  }, [result, xs, xMode, theme]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.setOption(option, { notMerge: true });
    // Keep the lineX brush armed so a plain drag selects a range.
    c.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
  }, [option]);

  // Overlays (segment highlight + selection) are merged into the existing option.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const t = TOKENS[theme];
    const seg = highlightSegment != null ? result.segments[highlightSegment] : undefined;
    const hlData: [number, number][] = [];
    const hlArea: unknown[] = [];
    if (seg) {
      const from = segmentDrawStart(result.segments, highlightSegment!);
      for (let i = from; i <= seg.endIndex; i++) hlData.push([xs[i], result.points[i].altitude]);
      hlArea.push([{ xAxis: xs[from] }, { xAxis: xs[seg.endIndex] }]);
    }
    const selArea = selection ? [[{ xAxis: xs[selection[0]] }, { xAxis: xs[selection[1]] }]] : [];
    const selMark = {
      silent: true,
      itemStyle: { color: t.sel, borderColor: t.selEdge, borderWidth: 1 },
      data: selArea,
    };
    c.setOption({
      series: [
        { id: 'profile', markArea: selMark },
        { id: 'vs', markArea: selMark },
        {
          id: 'hl',
          data: hlData,
          lineStyle: { color: t.line, width: 3 },
          markArea: { silent: true, itemStyle: { color: t.band }, data: hlArea },
        },
      ],
    });
  }, [highlightSegment, selection, result, xs, theme, option]);

  return (
    <div
      ref={el}
      className="chart"
      role="img"
      aria-label="Elevation profile and vertical speed graph, coloured by vertical speed. Drag to select a range."
    />
  );
}
