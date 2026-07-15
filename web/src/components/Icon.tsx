import type React from 'react'

export type IconName = 'ai' | 'animation' | 'arrowDown' | 'arrowUp' | 'check' | 'clock' | 'copy' | 'cursor' | 'delete' | 'download' | 'edit' | 'eye' | 'image' | 'layout' | 'link' | 'message' | 'more' | 'move' | 'palette' | 'play' | 'plus' | 'publish' | 'search' | 'settings' | 'share' | 'target' | 'text' | 'unlink' | 'warning'

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const content: Record<IconName, React.ReactNode> = {
    ai: <><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/></>,
    animation: <><rect x="4" y="5" width="11" height="11" rx="2"/><path d="M9 19h10V9M12 12l7-7m-4 0h4v4"/></>,
    arrowDown: <><path d="M12 4v16"/><path d="m6 14 6 6 6-6"/></>,
    arrowUp: <><path d="M12 20V4"/><path d="m6 10 6-6 6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    cursor: <><path d="m5 3 13 9-6 1.5L9 19 5 3Z"/><path d="m13 14 4 5"/></>,
    delete: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7"/><path d="M10 11v5m4-5v5"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/></>,
    edit: <><path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/><path d="m14.5 6.5 3 3"/></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>,
    layout: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></>,
    message: <><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8m-8 3h5"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    move: <><path d="M12 2v20M2 12h20"/><path d="m8 6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/></>,
    palette: <><path d="M12 3a9 9 0 1 0 0 18h1.4a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r="1" fill="currentColor"/><circle cx="10" cy="6.8" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/></>,
    play: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    publish: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 14v5h14v-5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
    text: <><path d="M5 6V4h14v2M12 4v16m-4 0h8"/></>,
    unlink: <><path d="m9.5 14.5-1 1a3.5 3.5 0 0 1-5-5l2-2a3.5 3.5 0 0 1 4.9-.1"/><path d="m14.5 9.5 1-1a3.5 3.5 0 0 1 5 5l-2 2a3.5 3.5 0 0 1-4.9.1"/><path d="m3 3 18 18"/></>,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/></>,
  }
  return <svg {...common}>{content[name]}</svg>
}
