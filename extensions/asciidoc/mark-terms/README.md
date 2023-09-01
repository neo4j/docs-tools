# mark-terms

Marks the first usage of a term or terms on a page by appending asciidoc after the term. Typically, this is used to add a registered trademark.

## Usage

Add the extension to a playbook:

```
asciidoc:
  extensions:
  - ./extensions/mark-terms/mark-terms.js
```

Add a comma-separated list of terms to be marked:

```
asciidoc:
  attributes:
    page-terms-to-mark: Term1, Term2
```

Optionally, add the asciidoc to be appended to the first instance of the term:

```
asciidoc:
  attributes:
    page-terms-marker: &copy;
```

If you don't add `page-terms-marker`, the default value is used. The default value is `&reg;`

## Limitationa and known issues

The extension reads the document blocks and matches 