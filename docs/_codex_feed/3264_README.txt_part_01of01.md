# File: README.txt (part 1 of 1)
```

Codex Ingest Helper
===================

What this does
--------------
- Walks a folder, finds text/code files, skips obvious binary blobs.
- Splits each file into ~12k-character parts on safe boundaries.
- Emits Markdown parts into a _codex_feed folder inside your source tree.
- Generates manifest.json and manifest.csv so you can paste parts in order.
- Optionally emits a single combined_all.md if -MakeCombined is set.

Quick start
-----------
1) Download both files in this folder:
   - codex_ingest.ps1
   - run_codex_ingest.cmd

2) Open "Command Prompt" and run:
   run_codex_ingest.cmd "C:\path\to\your\project" 14000

3) Open the generated _codex_feed folder:
   - Drag multiple .md parts into your Codex/Claude project, or
   - Open combined_all.md and paste sequentially.

Tips
----
- Adjust -IncludeExt to widen/narrow which files are included.
- Use -Exclude to skip paths like node_modules, dist, .git, etc.
- If a single file is still too large, lower -ChunkChars.
- For PDFs or images, pre-extract text using your preferred tool (pdftotext, tesseract).

```

