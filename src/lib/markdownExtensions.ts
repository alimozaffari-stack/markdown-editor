import type { AnyExtension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { CollapsibleHeadings } from "../components/editor/CollapsibleHeadings.ts";
import { FootnoteReference } from "../components/editor/FootnoteReference.ts";
import { Frontmatter } from "../components/editor/Frontmatter.ts";
import { lowlight } from "../components/editor/lowlight.ts";
import { ScratchBlockMath } from "../components/editor/MathExtensions.ts";
import { Wikilink } from "../components/editor/Wikilink.ts";

interface MarkdownSchemaExtensionOptions {
  codeBlock?: AnyExtension;
  link?: AnyExtension;
  table?: AnyExtension;
  blockMath?: AnyExtension;
  onBlockMathClick?: (node: ProseMirrorNode, position: number) => void;
}

export function createMarkdownSchemaExtensions(
  options: MarkdownSchemaExtensionOptions = {},
): AnyExtension[] {
  const codeBlock =
    options.codeBlock ??
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
    });

  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      link: false,
    }),
    CollapsibleHeadings.configure({
      levels: [1, 2, 3, 4, 5, 6],
    }),
    codeBlock,
    options.link ??
      Link.configure({
        openOnClick: false,
      }),
    Image.configure({
      inline: false,
      allowBase64: false,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Highlight.configure({
      multicolor: true,
    }),
    TextStyle,
    Color,
    options.table ??
      TableKit.configure({
        table: {
          resizable: false,
        },
      }),
    Frontmatter,
    Wikilink,
    FootnoteReference,
    options.blockMath ??
      ScratchBlockMath.configure({
        onClick: options.onBlockMathClick,
      }),
  ];
}
