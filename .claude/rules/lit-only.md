# Lit Only — No Other UI Frameworks

All UI components must use Lit (`LitElement`). Do not import React, Preact, Solid, or any other UI framework. If a library requires React as a peer dependency, find an alternative.

Component files use `.ts` extension with Lit template literals (`html\`...\``).

**Source:** ADR-001
