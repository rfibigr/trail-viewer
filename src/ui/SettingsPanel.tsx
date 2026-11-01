import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisOptions } from '../types';

interface SliderDef {
  key: keyof AnalysisOptions;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
}

const SLIDERS: SliderDef[] = [
  { key: 'smoothingWindowSec', label: 'Altitude smoothing', min: 0, max: 120, step: 5, unit: 's', hint: 'Window for smoothing altitude noise' },
  { key: 'segmentThresholdM', label: 'Segment threshold', min: 2, max: 60, step: 1, unit: 'm', hint: 'Reversal needed to start a new climb/descent' },
  { key: 'flatGradePct', label: 'Flat below', min: 0, max: 10, step: 0.5, unit: '%', hint: 'Segments with |grade| under this are flat' },
  { key: 'verticalSpeedWindowSec', label: 'Vert. speed window', min: 10, max: 300, step: 10, unit: 's', hint: 'Window for the rolling vertical speed' },
];

interface Props {
  options: AnalysisOptions;
  onChange: (options: AnalysisOptions) => void;
}

export function SettingsPanel({ options, onChange }: Props) {
  const isDefault = SLIDERS.every((s) => options[s.key] === DEFAULT_ANALYSIS_OPTIONS[s.key]);
  return (
    <section className="card settings" aria-labelledby="settings-title">
      <div className="card-head">
        <h2 id="settings-title">Analysis</h2>
        <button type="button" className="btn-link" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_ANALYSIS_OPTIONS })}>
          Reset
        </button>
      </div>
      {SLIDERS.map((s) => {
        const id = `opt-${s.key}`;
        return (
          <div className="slider" key={s.key}>
            <label htmlFor={id}>
              <span>{s.label}</span>
              <output htmlFor={id}>
                {options[s.key]} {s.unit}
              </output>
            </label>
            <input
              id={id}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={options[s.key]}
              title={s.hint}
              onChange={(e) => onChange({ ...options, [s.key]: Number(e.target.value) })}
            />
            <div className="slider-hint">{s.hint}</div>
          </div>
        );
      })}
    </section>
  );
}
