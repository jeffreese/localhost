import { describe, expect, it } from 'vitest'
import { matchListenersToProjects, parseCwdOutput, parseListenerOutput } from './listener-scanner'

describe('listener-scanner', () => {
  describe('parseListenerOutput', () => {
    it('parses pid and port from lsof -F pn output', () => {
      const output = ['p1234', 'f20', 'n*:3000', 'p5678', 'f20', 'n127.0.0.1:5173'].join('\n')

      expect(parseListenerOutput(output)).toEqual([
        { pid: 1234, port: 3000 },
        { pid: 5678, port: 5173 },
      ])
    })

    it('handles multiple ports per PID', () => {
      const output = ['p1234', 'f20', 'n*:3000', 'f21', 'n*:3001'].join('\n')

      expect(parseListenerOutput(output)).toEqual([
        { pid: 1234, port: 3000 },
        { pid: 1234, port: 3001 },
      ])
    })

    it('skips lines without port numbers', () => {
      const output = ['p1234', 'nlocalhost:http', 'n*:3000'].join('\n')

      expect(parseListenerOutput(output)).toEqual([{ pid: 1234, port: 3000 }])
    })

    it('returns empty array for empty output', () => {
      expect(parseListenerOutput('')).toEqual([])
    })
  })

  describe('parseCwdOutput', () => {
    it('parses pid and cwd from lsof -d cwd -F pn output', () => {
      const output = [
        'p1234',
        'fcwd',
        'n/Users/jeff/Code/my-app',
        'p5678',
        'fcwd',
        'n/Users/jeff/Code/other',
      ].join('\n')

      const result = parseCwdOutput(output)
      expect(result.get(1234)).toBe('/Users/jeff/Code/my-app')
      expect(result.get(5678)).toBe('/Users/jeff/Code/other')
    })

    it('skips non-filesystem paths', () => {
      const output = ['p1234', 'n->0xabcdef', 'p5678', 'fcwd', 'n/Users/jeff/Code/app'].join('\n')

      const result = parseCwdOutput(output)
      expect(result.has(1234)).toBe(false)
      expect(result.get(5678)).toBe('/Users/jeff/Code/app')
    })
  })

  describe('matchListenersToProjects', () => {
    it('matches listener to project by exact cwd', () => {
      const listeners = [{ pid: 1234, port: 3000 }]
      const cwdByPid = new Map([[1234, '/Users/jeff/Code/my-app']])
      const projectPaths = { '/Users/jeff/Code/my-app': '/Users/jeff/Code/my-app' }

      const result = matchListenersToProjects(listeners, cwdByPid, projectPaths)
      expect(result['/Users/jeff/Code/my-app']).toEqual([{ pid: 1234, port: 3000 }])
    })

    it('matches listener in subdirectory of project', () => {
      const listeners = [{ pid: 1234, port: 3000 }]
      const cwdByPid = new Map([[1234, '/Users/jeff/Code/my-app/packages/server']])
      const projectPaths = { '/Users/jeff/Code/my-app': '/Users/jeff/Code/my-app' }

      const result = matchListenersToProjects(listeners, cwdByPid, projectPaths)
      expect(result['/Users/jeff/Code/my-app']).toEqual([{ pid: 1234, port: 3000 }])
    })

    it('does not match listener outside project', () => {
      const listeners = [{ pid: 1234, port: 5432 }]
      const cwdByPid = new Map([[1234, '/usr/local/var/postgres']])
      const projectPaths = { '/Users/jeff/Code/my-app': '/Users/jeff/Code/my-app' }

      const result = matchListenersToProjects(listeners, cwdByPid, projectPaths)
      expect(result).toEqual({})
    })

    it('prefers nested project over parent', () => {
      const listeners = [{ pid: 1234, port: 3000 }]
      const cwdByPid = new Map([[1234, '/Users/jeff/Code/mono/packages/api']])
      const projectPaths = {
        '/Users/jeff/Code/mono': '/Users/jeff/Code/mono',
        '/Users/jeff/Code/mono/packages/api': '/Users/jeff/Code/mono/packages/api',
      }

      const result = matchListenersToProjects(listeners, cwdByPid, projectPaths)
      expect(result['/Users/jeff/Code/mono/packages/api']).toEqual([{ pid: 1234, port: 3000 }])
      expect(result['/Users/jeff/Code/mono']).toBeUndefined()
    })

    it('groups multiple listeners under same project', () => {
      const listeners = [
        { pid: 1234, port: 3000 },
        { pid: 5678, port: 5173 },
      ]
      const cwdByPid = new Map([
        [1234, '/Users/jeff/Code/my-app'],
        [5678, '/Users/jeff/Code/my-app'],
      ])
      const projectPaths = { '/Users/jeff/Code/my-app': '/Users/jeff/Code/my-app' }

      const result = matchListenersToProjects(listeners, cwdByPid, projectPaths)
      expect(result['/Users/jeff/Code/my-app']).toEqual([
        { pid: 1234, port: 3000 },
        { pid: 5678, port: 5173 },
      ])
    })

    it('returns empty result when no listeners provided', () => {
      const result = matchListenersToProjects([], new Map(), { '/tmp/my-app': '/tmp/my-app' })
      expect(result).toEqual({})
    })

    it('does not false-match similar path prefixes', () => {
      const listeners = [{ pid: 1234, port: 3000 }]
      const cwdByPid = new Map([[1234, '/Users/jeff/Code/my-app-old']])
      const projectPaths = { '/Users/jeff/Code/my-app': '/Users/jeff/Code/my-app' }

      const result = matchListenersToProjects(listeners, cwdByPid, projectPaths)
      expect(result).toEqual({})
    })
  })
})
