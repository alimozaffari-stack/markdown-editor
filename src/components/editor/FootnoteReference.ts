import { Node, type JSONContent, type MarkdownToken } from "@tiptap/core";

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-footnote-label"),
        renderHTML: (attributes) => ({
          "data-footnote-label": attributes.label,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-footnote-reference]" }];
  },

  renderHTML({ node }) {
    return [
      "span",
      {
        "data-footnote-reference": "",
        "data-footnote-label": node.attrs.label,
        class: "footnote-reference cursor-pointer inline-flex items-center px-1 py-0.5 rounded text-[10px] font-bold bg-accent/10 text-accent hover:bg-accent/20 transition-colors mx-0.5 select-all align-super",
        title: `Footnote [^${node.attrs.label}]. Click to view or edit description.`,
      },
      `[^${node.attrs.label ?? ""}]`,
    ];
  },

  markdownTokenName: "footnoteReference",

  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline" as const,
    start: "[^",
    tokenize(src: string, _tokens: MarkdownToken[]) {
      const match = src.match(/^\[\^([^\]]+?)\]/);
      if (!match) return undefined;
      return {
        type: "footnoteReference",
        raw: match[0],
        text: match[1],
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    return helpers.createNode("footnoteReference", { label: token.text });
  },

  renderMarkdown(node: JSONContent) {
    return `[^${node.attrs?.label ?? ""}]`;
  },
});
