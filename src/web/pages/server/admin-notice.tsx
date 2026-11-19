/**
 * The server's page, under the heading, for an admin just back from an
 * action: what it came to, as the Discord panel says it. Done is a success
 * banner whose title is the panel's first note and whose body holds the
 * other notes; when a step failed (a retry is offered for it now), it is a
 * warning that lists each failed step with its retry. Done while Discord is
 * still working says so; a refusal says nothing was changed, with the
 * panel's sentence. Nothing without a notice, or for a member who is no
 * longer an admin.
 */
import type { WebView } from "../../../guild/web-view";
import type { AdminNotice } from "../../admin/notice";
import { Banner } from "../../components/banner";
import { RetryItem } from "./admin-retry";
import { NoteText } from "./note-text";

/** The retries of `notice` that the view still offers. */
export function offeredRetries(view: WebView, notice: AdminNotice | null) {
  if (notice === null || view.admin === null) return [];
  const offered = view.admin.actions;
  return notice.retries.filter((retry) =>
    offered.some(
      (action) => action.kind === retry.kind && action.target === retry.target,
    ),
  );
}

export function AdminNoticeBanner({
  view,
  notice,
  csrf,
}: {
  view: WebView;
  notice: AdminNotice | null;
  csrf: string;
}) {
  if (notice === null || view.admin === null) return null;
  const lines = notice.lines.map((line) => (
    <p>
      <NoteText text={line} view={view} />
    </p>
  ));
  if (notice.kind === "refused") {
    return (
      <Banner tone="warning" title="Nothing was changed.">
        <div class="stack stack--tight">{lines}</div>
      </Banner>
    );
  }
  if (notice.kind === "finishing") {
    return (
      <Banner tone="info" title="Done. Discord is still finishing it.">
        <p>
          The rest happens in Discord in a moment. Reload this page to see how
          it went.
        </p>
      </Banner>
    );
  }
  const retries = offeredRetries(view, notice);
  const rest = lines.slice(1);
  return (
    <Banner
      tone={retries.length === 0 ? "success" : "warning"}
      title={
        notice.lines[0] === undefined ? (
          "Done."
        ) : (
          <NoteText text={notice.lines[0]} view={view} />
        )
      }
    >
      {rest.length + retries.length > 0 && (
        <div class="stack">
          {rest.length > 0 && <div class="stack stack--tight">{rest}</div>}
          {retries.length > 0 && (
            <>
              <p>
                <strong>
                  {retries.length === 1
                    ? "A step failed. Try it again:"
                    : "Some steps failed. Try each again:"}
                </strong>
              </p>
              <ul class="stack list-reset">
                {retries.map((retry) => (
                  <RetryItem view={view} action={retry} csrf={csrf} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Banner>
  );
}
