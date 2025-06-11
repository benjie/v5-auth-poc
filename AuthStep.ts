import {
  context,
  Maybe,
  Step,
  UnbatchedExecutionExtra,
  UnbatchedStep,
} from "grafast";
import {
  PgSelectQueryBuilder,
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
function getAuthRules(identifier: string, uid: Maybe<number>): AuthRule {
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
        (alias) => sql`${alias}.user_id = ${sqlValueWithCodec(uid, TYPES.int)}`,
      ],
    };
  }

  return {
    allow: false,
  };
}

export class AuthStep extends UnbatchedStep<PgSelectQueryBuilderCallback> {
  isSyncAndSafe = false;

  constructor(
    private ident: string,
    $userId: Step<Maybe<number>>,
  ) {
    super();
    this.addUnaryDependency($userId);
  }

  deduplicate(peers: readonly AuthStep[]) {
    // We're identical to all peers that have the same ident
    return peers.filter((p) => p.ident === this.ident);
  }

  unbatchedExecute(
    _extra: UnbatchedExecutionExtra,
    userId: Maybe<number>,
  ): PgSelectQueryBuilderCallback {
    const rules = getAuthRules(this.ident, userId);
    return (qb: PgSelectQueryBuilder) => {
      if (!rules.allow) {
        // Benjie doesn't know if this will work right. Probably!
        // Benjie doesn't like to throw errors in these situations: https://github.com/benjie/.dev/issues/25
        throw new Error("Access denied");
      }
      for (const cond of rules.conditions) {
        qb.where(cond(qb.alias));
      }
    };
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
  const $authStep = new AuthStep(ident, $userId);
  $pgSelect.apply($authStep);
}
