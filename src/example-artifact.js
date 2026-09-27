import { parseArtifactDocument } from "./artifact-schema.js";

export const DEMO_ARTIFACT_ID = "demo-authored-artifact";

export const DEMO_ARTIFACT = parseArtifactDocument({
  schemaVersion: 2,
  title: "A small page from the agent",
  kind: "interactive",
  html: `
<section class="page">
  <article class="folio">
    <p class="eyebrow">A SMALL ARTIFACT</p>
    <h1>Not every reply has to be a chat bubble.</h1>
    <p class="lede">This page is ordinary HTML + CSS authored as content. The host keeps the dangerous capabilities.</p>

    <fieldset class="choice">
      <legend>How should the next one feel?</legend>
      <label><input type="radio" name="mood" value="quiet" data-artifact-choice="mood"> Quiet</label>
      <label><input type="radio" name="mood" value="playful" data-artifact-choice="mood"> Playful</label>
      <label><input type="radio" name="mood" value="strange" data-artifact-choice="mood"> A little strange</label>
    </fieldset>

    <label class="note-label">
      Leave one line for the agent
      <textarea maxlength="280" data-artifact-note="reply" placeholder="Write here…"></textarea>
    </label>

    <button type="button" data-artifact-submit>Send this back</button>
    <p class="status" data-artifact-status></p>
  </article>
</section>
`,
  css: `
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#0d1725;color:#1f2730}
body{font-family:Georgia,"Times New Roman",serif}
.page{min-height:100vh;padding:24px 16px;display:grid;place-items:center;background:radial-gradient(circle at 50% 0%,#304664 0,#17263a 42%,#0d1725 100%)}
.folio{width:min(100%,460px);padding:30px 26px;background:#f2eadc;border:1px solid #c8b995;box-shadow:0 18px 48px rgba(0,0,0,.38),inset 0 0 0 5px #ebe1ce}
.eyebrow{margin:0 0 12px;text-align:center;font:700 10px/1.2 ui-sans-serif,system-ui;letter-spacing:.18em;color:#334963}
h1{margin:0;font-size:34px;line-height:1.05;font-weight:500}
.lede{margin:16px 0 24px;line-height:1.55;color:#5e584f}
.choice{display:grid;gap:8px;margin:0 0 18px;padding:16px;border:1px solid #c8b995}
.choice legend{padding:0 8px;font-weight:700}
.choice label{font-family:ui-sans-serif,system-ui;font-size:14px}
.note-label{display:grid;gap:8px;font:700 13px/1.4 ui-sans-serif,system-ui}
textarea{min-height:96px;width:100%;resize:vertical;padding:12px;border:1px solid #b8aa8d;background:#fffdf8;color:#23272c;font:16px/1.45 Georgia,serif}
button{width:100%;margin-top:16px;padding:13px 16px;border:0;background:#203b5e;color:white;font:700 14px/1 ui-sans-serif,system-ui;cursor:pointer}
button:disabled{opacity:.55;cursor:default}
.status{min-height:1.4em;margin:10px 0 0;color:#786f62;font:12px/1.4 ui-sans-serif,system-ui}
`,
  interactions: [
    {
      type: "choice",
      id: "mood",
      prompt: "How should the next one feel?",
      required: true,
      options: [
        { id: "quiet", label: "Quiet" },
        { id: "playful", label: "Playful" },
        { id: "strange", label: "A little strange" }
      ]
    },
    {
      type: "note",
      id: "reply",
      prompt: "Leave one line for the agent",
      required: true,
      maxChars: 280
    }
  ]
});
