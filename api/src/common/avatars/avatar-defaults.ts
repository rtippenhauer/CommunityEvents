/**
 * What a new community's avatar picker starts with (v2-47).
 *
 * One placeholder, not the 32 bears (Rob, 2026-11-09). The bears are
 * DinnerBears' own presets and arrive with it through the import; a community
 * created today has no claim on them, and shipping them as the default is the
 * bug this item exists to fix wearing a different hat -- the second community
 * to exist would find them in its picker and nobody would have chosen that.
 *
 * Empty was the alternative and was rejected: the picker is reachable from
 * Profile the moment a community exists, and an empty one reads as broken
 * rather than as unconfigured. One neutral entry says "add your own here".
 *
 * **The file is a different asset from `/assets/default-avatar.svg`**, which is
 * what every member list renders when somebody has no photo at all. They look
 * alike on purpose and must not be the same file: if picking the only preset
 * produced the same image as picking nothing, choosing it would be invisible.
 * Both ship in the frontend image.
 */
export const DEFAULT_AVATAR_PATH = '/avatars/cep-default.svg';

export interface AvatarDefaultRow {
  path: string;
  label: string;
  sortOrder: number;
}

/**
 * The rows `bootstrap.ts` and `tenants-admin.service.create` write for a
 * community that has just come into existence.
 *
 * A function rather than a constant for the reason `achievementDefaultRows` is
 * one: callers spread `tenantId` onto each row, and a shared array object would
 * hand every caller the same mutable row.
 */
export function avatarDefaultRows(): AvatarDefaultRow[] {
  return [{ path: DEFAULT_AVATAR_PATH, label: 'Default', sortOrder: 0 }];
}
