---
"@neuledge/context": minor
---

Markdown chunking now recursively splits on h3/h4/h5 headings when h2 sections exceed the token limit. Section titles use breadcrumb format ("Parent > Child > Grandchild") instead of "Section (part N)", improving search ranking. Documents without h2 headings (only h3+) now chunk correctly. Token estimation now differentiates code (~3 chars/token) from prose (~4.5 chars/token).
