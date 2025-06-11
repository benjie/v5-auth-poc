import {
  access,
  context,
  lambda,
  Maybe,
  Step,
  UnbatchedExecutionExtra,
  UnbatchedStep,
} from "grafast";
import {
  PgSelectQueryBuilderCallback,
  PgSelectStep,
  sqlValueWithCodec,
  TYPES,
} from "postgraphile/@dataplan/pg";
import { SQL, sql } from "postgraphile/pg-sql2";

type AuthRule =
  | {
      allow: true;
      conditions: ReadonlyArray<(alias: SQL) => SQL>;
    }
  | {
      allow: false;
    };

// should be an actual permission engine later
async function getAuthRules(
  identifiers: ReadonlySet<string>,
  uid: Maybe<number>,
): Promise<Record<string, AuthRule>> {
  const results = Object.create(null);
  // TODO: replace this with batch get rules for identifiers and uid
  for (const identifier of identifiers) {
    results[identifier] = ((): AuthRule => {
      if (uid == null) {
        return { allow: false };
      }
      if (identifier == "app.users") {
        return {
          allow: true,
          conditions: [
            (alias) => sql`${alias}.id = ${sqlValueWithCodec(uid, TYPES.int)}`,
          ],
        };
      }

      if (identifier === "app.posts") {
        return {
          allow: true,
          conditions: [
            (alias) =>
              sql`${alias}.user_id = ${sqlValueWithCodec(uid, TYPES.int)}`,
          ],
        };
      }

      return {
        allow: false,
      };
    })();
  }
  return results;
}

export class GetRulesStep extends UnbatchedStep<Record<string, AuthRule>> {
  isSyncAndSafe = false;

  private idents: Set<string>;
  constructor($userId: Step<Maybe<number>>) {
    super();
    this.idents = new Set();
    this.addUnaryDependency($userId);
  }

  get(identifier: string) {
    this.idents.add(identifier);
    return access(this, identifier) as Step<AuthRule>;
  }

  deduplicate(peers: readonly GetRulesStep[]) {
    // We're identical to all our peers, use deduplicateWith to add more idents
    return peers;
  }

  deduplicatedWith($replacement: GetRulesStep): void {
    for (const ident of this.idents) {
      $replacement.idents.add(ident);
    }
  }

  async unbatchedExecute(
    _extra: UnbatchedExecutionExtra,
    userId: Maybe<number>,
  ): Promise<Record<string, AuthRule>> {
    return getAuthRules(this.idents, userId);
  }
}

declare global {
  namespace Grafast {
    interface Context {
      userId?: number;
    }
  }
}

export function applyAuth(ident: string, $pgSelect: PgSelectStep) {
  const $userId = context().get("userId");
  const $allRules = new GetRulesStep($userId);
  const $identRules = $allRules.get(ident);
  $pgSelect.apply(
    lambda(
      $identRules,
      (rules): PgSelectQueryBuilderCallback =>
        (qb) => {
          if (!rules.allow) {
            // Don't throw, it will cause parent PgSelect to fail when inlined.
            // See also: https://github.com/benjie/.dev/issues/25
            qb.where(sql.false);
            // TODO: should augment PgSelectStep with support for something like
            // `qb.setIsNullFetch(true)` to avoid fetching entirely.
          } else {
            for (const cond of rules.conditions) {
              qb.where(cond(qb.alias));
            }
          }
        },
    ),
  );
}
