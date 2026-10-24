import { describe, expect, it } from 'vitest'
import { daysUntil, describeDue } from '../../src/ui'

// Local calendar date (months are 0-based in Date); the time of day must not matter.
const today = new Date(2026, 9, 24, 23, 30)

describe('due-date wording', () => {
  it('counts whole local calendar days, ignoring the time of day', () => {
    expect(daysUntil('2026-10-24', today)).toBe(0)
    expect(daysUntil('2026-10-25', new Date(2026, 9, 24, 0, 5))).toBe(1)
    expect(daysUntil('2026-10-20', today)).toBe(-4)
    expect(daysUntil('2026-11-01', today)).toBe(8) // across the end of a month
  })

  it('words open jobs relative to today', () => {
    expect(describeDue('2026-10-23', 'scheduled', today)).toEqual({
      text: 'Overdue by 1 day',
      tone: 'overdue',
    })
    expect(describeDue('2026-10-21', 'in_progress', today).text).toBe('Overdue by 3 days')
    expect(describeDue('2026-10-24', 'scheduled', today)).toEqual({
      text: 'Due today',
      tone: 'today',
    })
    expect(describeDue('2026-10-25', 'scheduled', today).text).toBe('Due tomorrow')
    expect(describeDue('2026-10-27', 'scheduled', today)).toEqual({
      text: 'Due in 3 days',
      tone: 'soon',
    })
    expect(describeDue('2026-11-20', 'scheduled', today).tone).toBe('later')
  })

  it('never calls a completed job overdue, and handles a missing date', () => {
    expect(describeDue('2026-10-01', 'completed', today).tone).toBe('done')
    expect(describeDue(null, 'scheduled', today)).toEqual({ text: 'No due date', tone: 'none' })
  })
})
