# APGMS Console UI Notes

The console shell is styled with Tailwind CSS tokens backed by CSS variables defined in [`src/globals.css`](./src/globals.css).

## Toggling light / dark

Dark mode is the default palette. To switch to the light palette, add the `.light` class to the `<html>` element (and remove it to return to dark):

```ts
const { classList } = document.documentElement;
classList.add("light"); // light mode
// classList.remove("light"); // dark mode
// classList.toggle("light"); // flip between modes
```

All semantic colors (`bg`, `fg`, `accent`, `muted`, etc.), border radii, and shadows draw from those CSS variables so components remain in sync across themes.
