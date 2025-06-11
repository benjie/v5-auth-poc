/* @ts-check */
import express from "express";
import { createServer } from "node:http";
import { postgraphile } from "postgraphile";
import { makePgService } from "postgraphile/adaptors/pg";
import { grafserv } from "postgraphile/grafserv/express/v4";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { applyAuth } from "./AuthStep";
import { PgSelectStep } from "postgraphile/@dataplan/pg";

const AuthPlugin: GraphileConfig.Plugin = {
  name: "AuthPlugin",
  version: "0.0.0",

  gather: {
    hooks: {
      pgTables_PgResourceOptions(info, event) {
        const {serviceName, pgClass: {relname, relnamespace}} = event
        const ident = `${relname}.${relnamespace}`
        event.resourceOptions.selectAuth = ($pgSelect: PgSelectStep) => {
          applyAuth(ident, $pgSelect);
          return $pgSelect;
        };
      },
    },
  },
};

/** @type {GraphileConfig.Preset} */
const preset = {
  extends: [PostGraphileAmberPreset],
  pgServices: [
    makePgService({
      connectionString: "postgres://postgres:postgres@localhost:5432/auth_poc",
      schemas: ["app"],
    }),
  ],
  plugins: [AuthPlugin],
  grafast: {
    explain: true,
    context(ctx: any) {
      const uid = ctx.expressv4?.req?.get("x-user-id");
      return {
        // This is obviously not secure; replace it with cookies or whatever
        currentUserId: uid ? parseInt(uid, 10) : undefined,
      };
    },
  },
};

const app = express();
const server = createServer(app);
server.on("error", (e) => {
  console.dir(e);
});
const pgl = postgraphile(preset);
const serv = pgl.createServ(grafserv);
await serv.addTo(app, server);
server.listen(5050, () => {
  console.log("Server listening at http://localhost:5050");
});
