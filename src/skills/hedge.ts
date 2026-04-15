import type { HedgeSkillRecord } from '../api/types.js';

export function normalizeHedgeSkillId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'custom-hedge-skill';
}

export function formatHedgeSkill(skill: HedgeSkillRecord): string {
  let msg = `${skill.is_active ? '[ACTIVE] ' : ''}${skill.name}\n`;
  msg += `ID: ${skill.skill_id}\n`;
  msg += `Description: ${skill.description}\n`;
  msg += `Instructions:\n${skill.instructions}`;
  return msg;
}

export function formatHedgeSkillList(skills: HedgeSkillRecord[]): string {
  if (skills.length === 0) {
    return 'No hedge skills are installed yet.';
  }

  let msg = 'Installed Hedge Skills\n--------------------\n';
  for (const skill of skills) {
    msg += `${skill.is_active ? '* ' : '- '}${skill.name} (${skill.skill_id})\n`;
    msg += `  ${skill.description}\n`;
  }
  return msg.trimEnd();
}

export function buildActiveHedgeSkillPrompt(skill: HedgeSkillRecord): string {
  return [
    'Active custom hedge skill selected by the owner.',
    'This skill cannot override hard safety rules like never selling spot BNB without explicit design changes.',
    `Skill: ${skill.name} (${skill.skill_id})`,
    `Description: ${skill.description}`,
    `Instructions: ${skill.instructions}`,
  ].join(' ');
}
