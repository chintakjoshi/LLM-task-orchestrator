from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TaskTemplateDefinition:
    template_id: str
    name: str
    description: str
    prompt_template: str

    def render_prompt(self, *, input_text: str) -> str:
        normalized_input = input_text.strip()
        return self.prompt_template.replace("{{input}}", normalized_input)


DEFAULT_TASK_TEMPLATES: tuple[TaskTemplateDefinition, ...] = (
    TaskTemplateDefinition(
        template_id="summarize_text",
        name="Summarize Text",
        description="Summarize provided content into concise bullet points.",
        prompt_template=(
            "You are an assistant producing concise summaries.\n"
            "Summarize the following content into 5 bullet points with key facts.\n\n"
            "{{input}}"
        ),
    ),
    TaskTemplateDefinition(
        template_id="extract_action_items",
        name="Extract Action Items",
        description="Extract owners, deadlines, and action items from text.",
        prompt_template=(
            "Extract concrete action items from the text below.\n"
            "For each action item include owner (if known), deadline (if present), and task.\n\n"
            "{{input}}"
        ),
    ),
    TaskTemplateDefinition(
        template_id="rewrite_professional",
        name="Rewrite Professional",
        description="Rewrite rough text into clear professional communication.",
        prompt_template=(
            "Rewrite the following message with a professional tone.\n"
            "Keep the meaning unchanged and improve clarity.\n\n"
            "{{input}}"
        ),
    ),
)
