import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ARTIFACT, DEMO_ARTIFACT_ID } from "../src/example-artifact.js";
import {
  authoredArtifactPageCsp,
  renderAuthoredArtifactPage,
} from "../src/render-artifact.js";

test("renders authored content in an opaque sandbox with a dedicated parent CSP", () => {
  const rendered = renderAuthoredArtifactPage(DEMO_ARTIFACT, {
    artifactId: DEMO_ARTIFACT_ID,
    interactionEndpoint: "/api/artifacts/demo-authored-artifact/interactions",
  });

  assert.match(rendered.html, /data-authored-artifact/u);
  assert.match(rendered.html, /sandbox="allow-scripts"/u);
  assert.doesNotMatch(rendered.html, /allow-same-origin/u);
  assert.match(rendered.html, /background:#0d1725/u);
  assert.match(rendered.html, /connect-src &amp;#39;none&amp;#39;/u);

  const expected = authoredArtifactPageCsp(rendered.nonce);
  assert.equal(rendered.csp, expected);
  assert.match(rendered.csp, /style-src 'self' 'unsafe-inline'/u);
  assert.match(rendered.csp, /script-src 'self' https:\/\/telegram\.org 'nonce-/u);
  assert.match(rendered.csp, /connect-src 'self'/u);
  assert.doesNotMatch(rendered.csp, /script-src[^;]*'unsafe-inline'/u);
});
