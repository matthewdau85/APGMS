const path = require("path");

function isPageFile(filename) {
  const normalised = filename.split(path.sep).join(path.posix.sep);
  return normalised.includes("src/pages/") && filename.endsWith(".tsx");
}

function getObjectProperty(node, name) {
  return node.properties.find(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      property.key.type === "Identifier" &&
      property.key.name === name
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure pages render the shared Page component with exported meta containing title and helpSlug",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (!isPageFile(filename)) {
      return {};
    }

    let hasPageElement = false;
    let pageMetaIdentifier = null;
    const exportedMeta = new Map();

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "Page") {
          return;
        }

        hasPageElement = true;
        const metaAttribute = node.attributes.find(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.name === "meta"
        );

        if (!metaAttribute) {
          context.report({
            node,
            message: "Page components must receive a meta prop with title and helpSlug.",
          });
          return;
        }

        if (
          !metaAttribute.value ||
          metaAttribute.value.type !== "JSXExpressionContainer"
        ) {
          context.report({
            node: metaAttribute,
            message: "Page meta prop must be an expression.",
          });
          return;
        }

        const expression = metaAttribute.value.expression;
        if (expression.type === "Identifier") {
          pageMetaIdentifier = expression.name;
        } else if (expression.type === "ObjectExpression") {
          const titleProp = getObjectProperty(expression, "title");
          const helpProp = getObjectProperty(expression, "helpSlug");
          if (!titleProp || !helpProp) {
            context.report({
              node: expression,
              message: "Page meta objects must define title and helpSlug properties.",
            });
          }
        } else {
          context.report({
            node: expression,
            message: "Page meta prop must be an object literal or identifier.",
          });
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.declaration) {
          return;
        }
        if (node.declaration.type === "VariableDeclaration") {
          for (const declarator of node.declaration.declarations) {
            if (
              declarator.id.type === "Identifier" &&
              declarator.init &&
              declarator.init.type === "ObjectExpression"
            ) {
              exportedMeta.set(declarator.id.name, {
                titleProp: getObjectProperty(declarator.init, "title"),
                helpProp: getObjectProperty(declarator.init, "helpSlug"),
              });
            }
          }
        }
      },
      "Program:exit"() {
        if (!hasPageElement) {
          context.report({
            loc: { line: 1, column: 0 },
            message:
              "Pages must render the shared <Page> component for consistent layout and help.",
          });
          return;
        }

        if (pageMetaIdentifier) {
          const metaInfo = exportedMeta.get(pageMetaIdentifier);
          if (!metaInfo) {
            context.report({
              message: `The meta identifier "${pageMetaIdentifier}" must be exported from the page file.`,
              loc: { line: 1, column: 0 },
            });
            return;
          }
          if (!metaInfo.titleProp || !metaInfo.helpProp) {
            context.report({
              node: metaInfo.titleProp?.parent ?? metaInfo.helpProp?.parent ?? null,
              message: "Exported page meta must include title and helpSlug properties.",
            });
          }
        } else {
          // If meta prop is inline object ensure required props exist.
          // The check occurs during JSXOpeningElement when inline object is used.
        }
      },
    };
  },
};
