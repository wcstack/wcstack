import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { config } from '../src/config';
import { SVG_NAMESPACE } from '../src/define';
import { convertMustacheToComments } from '../src/mustache/convertMustacheToComments';

describe('convertMustacheToComments', () => {
  let originalEnableMustache: boolean;

  beforeEach(() => {
    originalEnableMustache = config.enableMustache;
  });

  afterEach(() => {
    config.enableMustache = originalEnableMustache;
  });

  it('enableMustache=false の場合は変換しないこと', () => {
    config.enableMustache = false;
    const div = document.createElement('div');
    div.textContent = '{{ name }}';
    convertMustacheToComments(div);
    expect(div.textContent).toBe('{{ name }}');
    expect(div.childNodes.length).toBe(1);
    expect(div.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('テキストノード内の {{ xxx }} をコメントノードに変換すること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    div.textContent = '{{ name }}';
    convertMustacheToComments(div);
    expect(div.childNodes.length).toBe(1);
    const comment = div.childNodes[0];
    expect(comment.nodeType).toBe(Node.COMMENT_NODE);
    expect((comment as Comment).data).toBe('@@: name');
  });

  it('1つのテキストノードに複数の {{ }} がある場合に正しく分割すること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    div.textContent = '{{ first }}{{ second }}';
    convertMustacheToComments(div);
    expect(div.childNodes.length).toBe(2);
    expect(div.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((div.childNodes[0] as Comment).data).toBe('@@: first');
    expect(div.childNodes[1].nodeType).toBe(Node.COMMENT_NODE);
    expect((div.childNodes[1] as Comment).data).toBe('@@: second');
  });

  it('{{ }} の前後のテキストが保持されること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    div.textContent = 'Hello {{ name }}, age {{ age }}!';
    convertMustacheToComments(div);
    expect(div.childNodes.length).toBe(5);
    expect(div.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(div.childNodes[0].textContent).toBe('Hello ');
    expect(div.childNodes[1].nodeType).toBe(Node.COMMENT_NODE);
    expect((div.childNodes[1] as Comment).data).toBe('@@: name');
    expect(div.childNodes[2].nodeType).toBe(Node.TEXT_NODE);
    expect(div.childNodes[2].textContent).toBe(', age ');
    expect(div.childNodes[3].nodeType).toBe(Node.COMMENT_NODE);
    expect((div.childNodes[3] as Comment).data).toBe('@@: age');
    expect(div.childNodes[4].nodeType).toBe(Node.TEXT_NODE);
    expect(div.childNodes[4].textContent).toBe('!');
  });

  it('<script> 内のテキストは変換しないこと', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    const script = document.createElement('script');
    script.textContent = 'const x = "{{ name }}";';
    div.appendChild(script);
    convertMustacheToComments(div);
    expect(script.textContent).toBe('const x = "{{ name }}";');
    expect(script.childNodes.length).toBe(1);
    expect(script.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('<style> 内のテキストは変換しないこと', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = '.cls { content: "{{ name }}"; }';
    div.appendChild(style);
    convertMustacheToComments(div);
    expect(style.textContent).toBe('.cls { content: "{{ name }}"; }');
    expect(style.childNodes.length).toBe(1);
    expect(style.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('<template> 内のコンテンツも再帰的に変換すること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    const template = document.createElement('template');
    template.innerHTML = '<span>{{ item }}</span>';
    div.appendChild(template);
    convertMustacheToComments(div);
    const span = template.content.querySelector('span')!;
    expect(span.childNodes.length).toBe(1);
    expect(span.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((span.childNodes[0] as Comment).data).toBe('@@: item');
  });

  it('ネストした <template> 内も変換すること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    const outerTemplate = document.createElement('template');
    outerTemplate.innerHTML = '<template><p>{{ nested }}</p></template>';
    div.appendChild(outerTemplate);
    convertMustacheToComments(div);
    const innerTemplate = outerTemplate.content.querySelector('template')!;
    const p = innerTemplate.content.querySelector('p')!;
    expect(p.childNodes.length).toBe(1);
    expect(p.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((p.childNodes[0] as Comment).data).toBe('@@: nested');
  });

  it('{{ }} がないテキストノードは変更しないこと', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    div.textContent = 'Hello World';
    convertMustacheToComments(div);
    expect(div.childNodes.length).toBe(1);
    expect(div.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(div.textContent).toBe('Hello World');
  });

  it('フィルタ付き {{ count@cart|gt(0) }} が正しく変換されること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    div.textContent = '{{ count@cart|gt(0) }}';
    convertMustacheToComments(div);
    expect(div.childNodes.length).toBe(1);
    expect(div.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((div.childNodes[0] as Comment).data).toBe('@@: count@cart|gt(0)');
  });

  it('{{ }} 内の空白がトリムされること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    div.textContent = '{{   name   }}';
    convertMustacheToComments(div);
    expect(div.childNodes.length).toBe(1);
    expect(div.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((div.childNodes[0] as Comment).data).toBe('@@: name');
  });

  it('SVG名前空間の<template>をHTML templateに変換して再帰処理すること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    // SVG名前空間でtemplate要素を作成
    const svgTemplate = document.createElementNS(SVG_NAMESPACE, 'template');
    const span = document.createElement('span');
    span.textContent = '{{ svgValue }}';
    svgTemplate.appendChild(span);
    svgTemplate.setAttribute('data-bind', 'if:visible');
    svgTemplate.setAttribute('id', 'svg-tmpl');
    div.appendChild(svgTemplate);

    convertMustacheToComments(div);

    // SVG templateがHTML templateに置き換わっていること
    const replaced = div.querySelector('template')!;
    expect(replaced).not.toBeNull();
    expect(replaced.namespaceURI).not.toBe(SVG_NAMESPACE);
    // 属性がコピーされていること
    expect(replaced.getAttribute('data-bind')).toBe('if:visible');
    expect(replaced.getAttribute('id')).toBe('svg-tmpl');
    // template.content内のmustacheが変換されていること
    const innerSpan = replaced.content.querySelector('span')!;
    expect(innerSpan.childNodes.length).toBe(1);
    expect(innerSpan.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((innerSpan.childNodes[0] as Comment).data).toBe('@@: svgValue');
  });

  it('SVG名前空間の<template>で子ノードがない場合も処理できること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    const svgTemplate = document.createElementNS(SVG_NAMESPACE, 'template');
    div.appendChild(svgTemplate);

    convertMustacheToComments(div);

    const replaced = div.querySelector('template')!;
    expect(replaced).not.toBeNull();
    expect(replaced.content.childNodes.length).toBe(0);
  });

  it('SVG名前空間の<template>で複数の子ノードがすべてコピーされること', () => {
    config.enableMustache = true;
    const div = document.createElement('div');
    const svgTemplate = document.createElementNS(SVG_NAMESPACE, 'template');
    const p1 = document.createElement('p');
    p1.textContent = '{{ first }}';
    const p2 = document.createElement('p');
    p2.textContent = '{{ second }}';
    svgTemplate.appendChild(p1);
    svgTemplate.appendChild(p2);
    div.appendChild(svgTemplate);

    convertMustacheToComments(div);

    const replaced = div.querySelector('template')!;
    const paragraphs = replaced.content.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((paragraphs[0].childNodes[0] as Comment).data).toBe('@@: first');
    expect(paragraphs[1].childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect((paragraphs[1].childNodes[0] as Comment).data).toBe('@@: second');
  });
});
