---
description: Review Neo4j docs AsciiDoc against the style guide — a whole file as-is, or just your changes (advisory)
argument-hint: "[PATH | changes [base]]   # omit = open file; PATH = whole file/dir; 'changes [base]' = only what changed"
allowed-tools: Read, Glob, WebFetch, Bash(git diff:*), Bash(git status:*), Bash(git merge-base:*), Bash(git rev-parse:*), Bash(test:*), Bash(printenv:*)
---

You are running an **advisory, local style-guide self-check** for a docs author.
Print findings here in the chat. There are two modes — pick one from `$ARGUMENTS`.

## 1. Pick the mode

- **`$ARGUMENTS` is `-h`, `--help`, or `help`** → print the usage summary below and **stop**.
  Do not load any prompt or style guide, and do not review anything.

  ```
  /neo4j-docs-style [PATH | changes [base] | -h]

  Advisory Neo4j docs style self-check. Prints findings in chat; never writes or posts.

    (no args)        Whole-file review of the AsciiDoc file open in the editor.
    PATH             Whole-file review of a file, or every *.adoc under a directory.
    changes [base]   Review only what changed vs base (default origin/dev, else
                     origin/main); committed + uncommitted; pages/partials only.
    diff [base]      Alias for 'changes'.
    -h | --help      Show this help.

  Examples:
    /neo4j-docs-style
    /neo4j-docs-style modules/ROOT/pages/index.adoc
    /neo4j-docs-style modules/ROOT/pages/
    /neo4j-docs-style changes dev

  Env: STYLE_GUIDE_LLMS_URL=<url-or-path>  point at a different guide or a local copy.
  ```

- **`$ARGUMENTS` is empty** → **Whole-file mode** on the AsciiDoc file currently **open in the
  editor** (take it from the IDE context). If no file is open, ask which file to review and stop.
- **`$ARGUMENTS` starts with `changes` or `diff`** (optionally followed by a base ref,
  e.g. `changes`, `changes dev`, `diff origin/main`) → **Changes mode**.
- **Otherwise** → **Whole-file mode**, treating `$ARGUMENTS` as a PATH.

### Whole-file mode (review the current content, NOT a diff — nothing to do with git)
- If a PATH was given and it is a file (`test -f`) → review that whole file.
- If a PATH was given and it is a directory (`test -d`) → review every `*.adoc` under it
  (enumerate with Glob `"<dir>/**/*.adoc"`).
- Otherwise review the file open in the editor.
- Read the full current content with the Read tool and review **all of it**, every line as it
  stands now. Do NOT diff against git in this mode.

### Changes mode (review only what changed vs the base, committed AND uncommitted)
- Base ref: the word after `changes`/`diff` if given, else auto-detect `origin/dev`
  (`git rev-parse --verify origin/dev`), else `origin/main`.
- Branch point: `git merge-base <base> HEAD`.
- Changed files: `git diff --name-only <merge-base>` + untracked from `git status --porcelain` (`??`).
- Restrict to page/partial AsciiDoc: paths matching `**/modules/**/pages/**/*.adoc` and
  `**/modules/**/partials/**/*.adoc`. If none match, say so and stop.
- Per-file: `git diff <merge-base> -- <file>` (untracked → read the whole file as added).
  Focus only on the ADDED/CHANGED lines.

In both modes, skip AsciiDoc comments (`//` single-line and `////` blocks) — they are not published.

## 2. Load the review instructions (single source of truth)

Read the base prompt and use it for **what to check** and **how to report**:

- If `prompts/docs-style-review.md` exists in this repo, **Read it** (you are in docs-tools).
- Otherwise **WebFetch** it from:
  `https://raw.githubusercontent.com/neo4j/docs-tools/main/prompts/docs-style-review.md`

Then, if `.github/prompts/docs-style-review.md` exists in this repo, Read it too and
append it as **repository-specific guidance**.

**Overrides to the base prompt** (it is written for CI):
- It says to write a `style-review-comment.md` file and not post — ignore that; you print the
  review in the chat instead (step 4). This applies in BOTH modes.
- It says to review only the ADDED/CHANGED lines of a diff — that applies in **Changes mode
  only**. In **Whole-file mode**, ignore it and review the entire current file.
- Everything else — what to check, tone, citing the style guide, conciseness, the 10-finding /
  ~400-word limits — always applies.

## 3. Load the style guide

Resolve the style guide in this order (first match wins):

1. **Env override** — `printenv STYLE_GUIDE_LLMS_URL`. If set, it may be **either a URL or a
   local file path** (lets a user point at a different/draft guide, or at a local copy to skip
   refetching):
   - Starts with `http://` or `https://` → **WebFetch** it.
   - Otherwise (a filesystem path, or a `file://` URL) → strip any `file://` prefix and **Read**
     the file with the Read tool (confirm it exists with `test -f` first).
2. **Default** — otherwise **WebFetch** the canonical Neo4j docs style guide:
   `https://neo4j.com/docs/docs-style-guide/llms.txt`

Whatever you resolve, it is the single consolidated style guide; use it as your reference and
load nothing else.

If the override file is missing or the URL is unreachable, say so in one line, then fall back to
the default URL — and if that is also unreachable, to general technical-writing best practice.
(Tip the author: `export STYLE_GUIDE_LLMS_URL=<url-or-path>` to point at a different guide or a
local copy.)

## 4. Produce the review

Print the review directly here in your reply (do not write any file, do not post anything).
Begin by stating this is an automated, advisory style-guide self-check, name the mode and the
file(s) reviewed. Group findings by file; for each, quote the snippet, explain the issue, and
cite the relevant style-guide section. Be concise. If a file has no notable issues, say
"no notable style issues found" for it.
