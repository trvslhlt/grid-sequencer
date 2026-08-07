/** Wanders each EffectSpec's own drifting numeric params (see
 * EffectSpec.drift's doc) slowly and continuously while the app runs --
 * tightly coupled to GridModel (reads live row/master/send-bus effects,
 * pushes updates through model.applyLiveEffectParam), so unlike the
 * bruit-kit modules it builds on, this orchestration itself isn't meant to
 * move there wholesale. Kept as its own file anyway so that orchestration
 * stays separate from the pure pacing math it builds on (see bruit-kit's
 * own driftMath.ts) -- a future app with its own "wander some live
 * params" engine could still reuse retargetDelayMsFor/lerpFactorFor even
 * though this exact loop stays specific to GridModel's own effect
 * targets. */

import {
  DRIFT_TICK_MS,
  type EffectSpec,
  type EffectType,
  lerpFactorFor,
  retargetDelayMsFor,
} from "bruit-kit/audio";
import {
  EFFECT_TABLE,
  type EffectRangeParamSpec,
  activeRangeFor,
} from "bruit-kit/ui";
import type { EffectLiveTarget, GridModel } from "./gridModel";

interface DriftState {
  target: EffectLiveTarget;
  index: number;
  type: EffectType;
  key: string;
  scale: number;
  /** Display units (matches activeRangeFor/hardBoundFor's own unit --
   * see EffectRangeParamSpec's own doc on why min/max/step are display
   * units while stored/default are the effect class's native unit). */
  current: number;
  wanderTarget: number;
  nextRetargetAt: number;
  min: number;
  max: number;
}

function driftTargetKey(target: EffectLiveTarget): string {
  return target.kind === "row" ? `row:${target.rowId}` : target.kind;
}

/** Runs for the lifetime of the view (started once by createGridView,
 * never stopped -- matches main.ts's own dirty-check interval; this
 * app's SPA session has no explicit teardown). Independently re-reads
 * the model's current effects data every tick rather than caching
 * anything about "what's drifting" across ticks beyond each param's own
 * wander position, so toggling Drift on/off, editing a chain, or
 * removing/reordering an effect all just fall out of always reading
 * fresh state -- no separate invalidation path needed.
 *
 * Bypasses setRowEffects/setMasterEffects/setSendBusEffects's normal
 * rebuild-the-whole-chain path entirely (see
 * BuiltEffectsChain.setParamsAt) -- this fires several times a second,
 * and a full disconnect/reconnect rebuild at that rate would both waste
 * work and risk an audible click on every tick. */
export function startDriftEngine(model: GridModel): void {
  const states = new Map<string, DriftState>();

  function collectTargets(): Array<{
    target: EffectLiveTarget;
    effects: EffectSpec[];
  }> {
    return [
      { target: { kind: "master" }, effects: model.getMasterEffects() },
      { target: { kind: "sendBus" }, effects: model.getSendBusEffects() },
      ...model.getRows().map((row) => ({
        target: { kind: "row", rowId: row.id } as const,
        effects: row.config.effects,
      })),
    ];
  }

  setInterval(() => {
    const targets = collectTargets();
    const seen = new Set<string>();

    for (const { target, effects } of targets) {
      effects.forEach((spec, index) => {
        const drift = spec.drift;
        if (!drift) return;
        const table = EFFECT_TABLE.find((e) => e.type === spec.type);
        if (!table) return;
        for (const key of Object.keys(drift)) {
          const param = table.params.find(
            (p): p is EffectRangeParamSpec =>
              p.key === key && p.kind === "range",
          );
          if (!param) continue;
          const speed = drift[key]?.speed ?? 0.5;

          const stateKey = `${driftTargetKey(target)}:${index}:${spec.type}:${key}`;
          seen.add(stateKey);
          const scale = param.scale ?? 1;
          const active = activeRangeFor(spec, param);
          let state = states.get(stateKey);
          if (!state) {
            const stored = spec.params[key];
            const baseDisplay =
              (typeof stored === "number" ? stored : param.default) * scale;
            state = {
              target,
              index,
              type: spec.type,
              key,
              scale,
              current: baseDisplay,
              wanderTarget: baseDisplay,
              nextRetargetAt: Date.now() + retargetDelayMsFor(speed),
              min: active.min,
              max: active.max,
            };
            states.set(stateKey, state);
          } else {
            // The active range may have been (re)customized since the
            // last tick -- keep wandering, just within whatever bounds
            // are current now.
            state.min = active.min;
            state.max = active.max;
          }

          const now = Date.now();
          if (now >= state.nextRetargetAt) {
            state.wanderTarget =
              state.min + Math.random() * (state.max - state.min);
            state.nextRetargetAt = now + retargetDelayMsFor(speed);
          }
          const delta =
            (state.wanderTarget - state.current) * lerpFactorFor(speed);
          // Once settled near its current wander target, skip pushing an
          // effectively-unchanged value every 150ms until the next
          // retarget actually moves it -- (state.max - state.min) scales
          // the "close enough" threshold to each param's own range instead
          // of one fixed number working for a 0..1 param and a 200..8000Hz
          // one equally badly.
          if (Math.abs(delta) > (state.max - state.min) * 0.0005) {
            state.current += delta;
            model.applyLiveEffectParam(
              target,
              index,
              key,
              state.current / scale,
            );
          }
        }
      });
    }

    for (const [stateKey, state] of states) {
      if (seen.has(stateKey)) continue;
      // No longer drifting (toggled off, effect removed, or reordered
      // out from under this index) -- snap back to whatever's actually
      // saved there now, but only if this index still holds the same
      // effect type this state was tracking; if some other effect has
      // since taken that slot, touching it here would misapply this
      // reset to the wrong instance entirely, so it's skipped instead.
      const currentSpec = targets.find(
        (t) => driftTargetKey(t.target) === driftTargetKey(state.target),
      )?.effects[state.index];
      if (currentSpec?.type === state.type) {
        const stored = currentSpec.params[state.key];
        if (typeof stored === "number") {
          model.applyLiveEffectParam(
            state.target,
            state.index,
            state.key,
            stored,
          );
        }
      }
      states.delete(stateKey);
    }
  }, DRIFT_TICK_MS);
}
