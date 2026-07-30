import assert from "node:assert/strict";
import test from "node:test";
import type {
  DocumentSaveRequest,
  DocumentSnapshot,
} from "./documentLifecycle.ts";
import { rebaseSaveRequestToSnapshot } from "./noteSaveRebase.ts";

const request: DocumentSaveRequest = {
  content: "# Latest body\n",
  contentBaseline: "# Old body\n",
  sourceBaseline: "# Old body\n\n[^1]: Old annotation\n",
  baselineHash: "old-hash",
  revision: 1,
  encoding: "utf-8",
  bom: "none",
  lineEnding: "lf",
  authority: "visual",
  reason: "autosave",
};

test("queued document saves rebase onto the preceding annotated snapshot", () => {
  const preceding: DocumentSnapshot = {
    content: "# Preceding body\n",
    sourceContent: "# Preceding body\n\n[^1]: Latest annotation\n",
    hash: "preceding-hash",
    revision: 2,
    encoding: "utf-16le",
    bom: "utf-16le",
    lineEnding: "crlf",
  };

  assert.deepEqual(rebaseSaveRequestToSnapshot(request, preceding), {
    ...request,
    contentBaseline: preceding.content,
    sourceBaseline: preceding.sourceContent,
    baselineHash: preceding.hash,
    revision: preceding.revision,
    encoding: preceding.encoding,
    bom: preceding.bom,
    lineEnding: preceding.lineEnding,
  });
});

test("stale annotation baselines are removed when the preceding note has none", () => {
  const preceding: DocumentSnapshot = {
    content: "# Plain note\n",
    hash: "plain-hash",
    revision: 3,
    encoding: "utf-8",
    bom: "none",
    lineEnding: "lf",
  };

  const rebased = rebaseSaveRequestToSnapshot(request, preceding);

  assert.equal(rebased.contentBaseline, undefined);
  assert.equal(rebased.sourceBaseline, undefined);
  assert.equal(rebased.baselineHash, "plain-hash");
});
