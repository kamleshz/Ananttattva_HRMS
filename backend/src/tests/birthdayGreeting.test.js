import test from 'node:test'
import assert from 'node:assert/strict'
import { birthdayPeriod,isBirthday } from '../services/birthdayGreetingService.js'

test('birthday date is evaluated in India timezone',()=>{const now=new Date('2026-09-17T18:31:00.000Z');assert.equal(birthdayPeriod(now).period,'2026-09-18');assert.equal(isBirthday(new Date('1995-09-18T00:00:00.000Z'),now),true)})
test('non-matching birthdays are ignored',()=>assert.equal(isBirthday(new Date('1995-09-19T00:00:00.000Z'),new Date('2026-09-18T06:00:00.000Z')),false))
