import type { User } from '../types'

export function userInitials(name: string, email = ''): string {
  const value = (name.trim() || email.split('@')[0] || '?').trim()
  const words = value.split(/[\s._-]+/).filter(Boolean)
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  const capitals = value.match(/[A-Z]/g)
  if (capitals && capitals.length > 1) return capitals.slice(0, 2).join('')
  return Array.from(value).slice(0, 2).join('').toUpperCase()
}

export default function UserAvatar({ user, size = 36 }: { user: Pick<User, 'name' | 'email'>; size?: number }) {
  return <span className="user-avatar" style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * .32)) }} aria-hidden>{userInitials(user.name, user.email)}</span>
}
