// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MarkdownContent from './MarkdownContent.vue'

describe('MarkdownContent', () => {
  it('renders Markdown structure while removing executable HTML', () => {
    const wrapper = mount(MarkdownContent, {
      props: {
        content: [
          '# Heading',
          '',
          '- First item',
          '- Second item',
          '',
          '[Documentation](https://example.com)',
          '[Unsafe](javascript:alert(1))',
          '![Tracking pixel](https://example.com/pixel.png)',
          '',
          '`inline code`',
          '',
          '<img src=x onerror="alert(1)">',
          '<script>alert(1)</script>',
        ].join('\n'),
      },
    })

    expect(wrapper.get('h1').text()).toBe('Heading')
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['First item', 'Second item'])
    expect(wrapper.get('code').text()).toBe('inline code')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('Tracking pixel')
    expect(wrapper.get('a').attributes()).toMatchObject({
      href: 'https://example.com',
      target: '_blank',
      rel: 'noopener noreferrer',
    })
    expect(wrapper.findAll('a')[1]?.attributes('href')).toBeUndefined()
  })
})
