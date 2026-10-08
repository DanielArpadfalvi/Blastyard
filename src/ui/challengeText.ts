import type { LevelDef, Objective, StarCond } from '../game/challenge';
import { t } from '../i18n';

/** One-line description of an objective. */
export function objectiveText(o: Objective): string {
  switch (o.type) {
    case 'crates':
      return t('objCrates', { n: o.seconds ?? 0 });
    case 'monsters':
      return o.seconds ? t('objMonstersTimed', { n: o.seconds }) : t('objMonsters');
    case 'flag':
      return o.seconds ? t('objFlag', { n: o.seconds }) : t('objFlagFree');
    case 'survive':
      return t('objSurvive', { n: o.seconds ?? 0 });
    case 'win':
      return t('objWin');
    case 'collect':
      return t('objCollect', { count: o.count ?? 1, n: o.seconds ?? 0 });
    case 'chain':
      return t('objChain', { count: o.count ?? 1, n: o.seconds ?? 0 });
  }
}

/** Objective text of a level (a gauntlet counts its stages). */
export function levelObjectiveText(level: LevelDef): string {
  if (level.stages.length > 1) return t('objGauntlet', { n: level.stages.length });
  return objectiveText(level.stages[0]!.objective);
}

/** Text of an extra star condition. */
export function starCondText(cond: StarCond): string {
  switch (cond.kind) {
    case 'time':
      return t('starTime', { n: cond.seconds });
    case 'bombs':
      return t('starBombs', { n: cond.max });
    case 'noDamage':
      return t('starNoDamage');
    case 'pickups':
      return t('starPickups', { n: cond.min });
  }
}
