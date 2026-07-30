import type {
  DocumentSaveRequest,
  DocumentSnapshot,
} from "./documentLifecycle";

export function rebaseSaveRequestToSnapshot(
  request: DocumentSaveRequest,
  snapshot: DocumentSnapshot,
): DocumentSaveRequest {
  const {
    contentBaseline: _contentBaseline,
    sourceBaseline: _sourceBaseline,
    ...requestWithoutSourceBaseline
  } = request;

  return {
    ...requestWithoutSourceBaseline,
    ...(snapshot.sourceContent === undefined
      ? {}
      : {
          contentBaseline: snapshot.content,
          sourceBaseline: snapshot.sourceContent,
        }),
    baselineHash: snapshot.hash,
    revision: snapshot.revision,
    encoding: snapshot.encoding,
    bom: snapshot.bom,
    lineEnding: snapshot.lineEnding,
  };
}
