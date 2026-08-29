# Synthetic fixtures

HTML sources for invoices we generated ourselves. Committed — unlike `../docs/`, which is
gitignored because real invoices carry third-party PII.

Regenerate a PDF after editing the HTML:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$PWD/ground-truth/docs/acme-0042.pdf" \
  "file://$PWD/ground-truth/fixtures/acme-0042.html"
```

Synthetic documents are for smoke-testing the plumbing, not for measuring accuracy. They
are too clean and, worse, we authored them — so the model does well on exactly the things
we thought to include. **Keep them out of the eval set**, or your numbers will flatter you.
