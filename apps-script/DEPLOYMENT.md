# Deploying the write endpoint

Create the Google Sheet that will hold the responses, then open
**Extensions → Apps Script** from that sheet and replace the contents of
`Code.gs` with the file next to this note. Deploy with **Deploy → New
deployment → Web app**, set *Execute as* to **Me** and *Who has access* to
**Anyone**, authorise it, and copy the resulting `…/exec` URL into
`CONFIG.endpoint` in `config.js`. The script creates a sheet named `responses`
with the four column headers on first write, so no manual setup is needed.
Every subsequent edit to `Code.gs` requires **Deploy → Manage deployments →
Edit → New version**; without that the old `/exec` URL keeps serving the old
code, silently. Note that *Who has access: Anyone* means exactly that — the URL
ships in the page source and anyone who finds it can append arbitrary rows
(§2). That is accepted for the MVP and removed by §12.
