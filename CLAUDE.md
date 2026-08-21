# docs-tools repo instructions

- Always work from a feature branch created off `dev`, unless explicitly told otherwise.
- When raising a PR, write a useful description of the actual work done. Do not add any
  Claude/Anthropic co-author credit or attribution anywhere (commits, PR description, PR comments).
- When updating an Antora extension (`extensions/antora/*`), remember to bump its
  `package.json` version. It's usually a patch bump, but ask every time rather than assuming.
