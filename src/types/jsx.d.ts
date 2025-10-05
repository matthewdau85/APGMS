declare namespace JSX {
  interface Element {}
  interface ElementClass {
    render?: any;
  }
  interface ElementAttributesProperty {
    props: any;
  }
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
