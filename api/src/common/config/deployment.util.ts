/**
 * Whether this deployment is a stage one (`IS_STAGE=true`).
 *
 * Reads `process.env` directly rather than going through `ConfigService`, for
 * two reasons that both matter:
 *
 *  - **The standalone scripts have no Nest container.** `bootstrap.ts` and
 *    `provision-tenant.ts` run as plain node processes and cannot inject
 *    anything, and they are two of the callers that need this answer.
 *  - **It is read at call time, not at construction.** Two services capture
 *    `IS_STAGE` in their constructors (the login-achievement window and the
 *    patriotic-bear date), which is fine for a value that never changes in a
 *    running process but makes the flag impossible to exercise both ways in a
 *    test without standing up a second application. The behaviours gated on
 *    this one -- who may sign in as automation, and which communities get a
 *    service account at all -- are exactly the kind that must be tested in both
 *    states, because the production half is the half nobody sees until it
 *    matters.
 *
 * Not a general licence to bypass ConfigService: everything else should keep
 * using it. This is the one flag with callers outside the container.
 */
export function isStageDeployment(): boolean {
  return process.env.IS_STAGE === 'true';
}
