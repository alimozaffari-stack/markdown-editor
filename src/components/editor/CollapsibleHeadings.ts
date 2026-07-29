import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Heading from "@tiptap/extension-heading";

export const CollapsibleHeadings = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
        renderHTML: (attributes) => {
          if (attributes.collapsed) {
            return { "data-collapsed": "true" };
          }
          return {};
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("collapsibleHeadings"),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr) {
            const decorations: Decoration[] = [];
            const doc = tr.doc;

            doc.descendants((node, pos) => {
              if (node.type.name === "heading") {
                const { level, collapsed } = node.attrs;

                // Add a widget decoration (collapse/expand chevron) at the start of every heading
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    (view, getPos) => {
                      const button = document.createElement("button");
                      button.className = "heading-collapse-btn absolute -left-6 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-text-muted hover:text-text hover:bg-bg-emphasis rounded transition-all cursor-pointer select-none";
                      button.type = "button";
                      button.style.outline = "none";

                      button.innerHTML = collapsed
                        ? `<svg class="w-3.5 h-3.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>`
                        : `<svg class="w-3.5 h-3.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>`;

                      button.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const actualPos = getPos();
                        if (actualPos === undefined) return;
                        const headingPos = actualPos - 1;
                        const headingNode = view.state.doc.nodeAt(headingPos);
                        if (headingNode && headingNode.type.name === "heading") {
                          view.dispatch(
                            view.state.tr.setNodeMarkup(headingPos, undefined, {
                              ...headingNode.attrs,
                              collapsed: !collapsed,
                            })
                          );
                        }
                      });

                      return button;
                    },
                    { side: -1, key: `collapse-widget-${pos}` }
                  )
                );

                if (collapsed) {
                  // Hide all subsequent nodes of lower headings or other blocks until a heading of equal/higher level
                  let currentPos = pos + node.nodeSize;
                  while (currentPos < doc.content.size) {
                    const nextNode = doc.nodeAt(currentPos);
                    if (!nextNode) break;

                    if (nextNode.type.name === "heading" && nextNode.attrs.level <= level) {
                      break;
                    }

                    decorations.push(
                      Decoration.node(currentPos, currentPos + nextNode.nodeSize, {
                        class: "collapsed-hidden-node",
                        style: "display: none !important; height: 0 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; border: none !important; pointer-events: none !important;",
                      })
                    );

                    currentPos += nextNode.nodeSize;
                  }
                }
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
