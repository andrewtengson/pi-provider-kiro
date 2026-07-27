// Feature 1: Extension Registration
//
// Entry point that wires all features together via pi.registerProvider().

import type { Api, Model, OAuthCredentials, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSafeError } from "./debug.js";
import { getKiroEndpoints, resolveApiRegion } from "./endpoints.js";
import { getKiroCliCredentials } from "./kiro-cli.js";
import { setExtensionContext } from "./login-ui.js";
import { getCachedModels, isCacheStale, type KiroModel, kiroModels, updateKiroModelsCache } from "./models.js";
import type { KiroCredentials } from "./oauth.js";
import { loginKiro, refreshKiroToken } from "./oauth.js";
import { streamKiro } from "./stream.js";
import { fetchKiroUsage } from "./usage.js";

export { resolveApiRegion } from "./endpoints.js";
export type { KiroStreamEvent } from "./event-parser.js";
export { KIRO_MODEL_IDS, kiroModels, resolveKiroModel } from "./models.js";
export { streamKiro } from "./stream.js";

/**
 * Host-driven catalog refresh.
 *
 * `oauth.modifyModels` only projects whatever the file cache already holds, so
 * this is the path that actually fetches when the host asks for a refresh or
 * the cache has gone stale. Persistence deliberately uses the existing Kiro
 * management file cache (`~/.kiro-management-models-cache.json`) rather than
 * `context.store`, so oauth/stream opportunistic refresh and host refresh all
 * share one catalog source.
 *
 * Fails open: a refresh error leaves the last-known cache in place and returns
 * it, because losing the model list is worse than serving a slightly stale one.
 */
async function refreshKiroModels(context: RefreshModelsContext): Promise<KiroModel[]> {
  const credential = context.credential;
  const oauthCredential = credential?.type === "oauth" ? (credential as unknown as KiroCredentials) : undefined;
  const cliCredential = oauthCredential ? undefined : getKiroCliCredentials();
  const accessToken = oauthCredential?.access ?? cliCredential?.access;
  const region = resolveApiRegion(oauthCredential?.region ?? cliCredential?.region);

  if (accessToken && context.allowNetwork && (context.force || isCacheStale(region))) {
    try {
      await updateKiroModelsCache(accessToken, region, oauthCredential?.profileArn ?? cliCredential?.profileArn);
    } catch (error) {
      console.warn(`[pi-provider-kiro] Host-driven catalog refresh failed in ${region}: ${formatSafeError(error)}`);
    }
  }

  const cached = getCachedModels(region);
  return cached.length > 0 ? cached : kiroModels;
}

export default function (pi: ExtensionAPI): void {
  // Capture ctx for the custom TUI login component
  pi.on("session_start", async (_event, ctx) => {
    setExtensionContext(ctx);
  });
  pi.registerProvider("kiro", {
    baseUrl: getKiroEndpoints("us-east-1").runtime,
    api: "kiro-api",
    models: getCachedModels("us-east-1"),
    refreshModels: refreshKiroModels,
    oauth: {
      // Name reflects all supported auth methods: AWS Builder ID, Google, GitHub
      name: "Kiro (Builder ID / Google / GitHub)",
      login: loginKiro,
      refreshToken: refreshKiroToken,
      getApiKey: (cred: OAuthCredentials) => cred.access,
      getCliCredentials: getKiroCliCredentials,
      modifyModels: (models: Model<Api>[], cred: OAuthCredentials) => {
        const apiRegion = resolveApiRegion((cred as KiroCredentials).region);
        const cachedKiro = getCachedModels(apiRegion);
        const nonKiro = models.filter((m: Model<Api>) => m.provider !== "kiro");
        const credentialProfileArn = (cred as KiroCredentials).profileArn;
        const modifiedKiro = cachedKiro.map((m: Model<Api>) => ({
          ...m,
          baseUrl: getKiroEndpoints(apiRegion).runtime,
          kiroRegion: apiRegion,
          ...(credentialProfileArn ? { kiroProfileArn: credentialProfileArn } : {}),
        }));

        return [...nonKiro, ...modifiedKiro];
      },
      fetchUsage: fetchKiroUsage,
      // biome-ignore lint/suspicious/noExplicitAny: ProviderConfig.oauth doesn't include getCliCredentials but OAuthProviderInterface does
    } as any,
    streamSimple: streamKiro,
  });
}
