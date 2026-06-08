const {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} = require('discord.js');

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function separator(spacing = SeparatorSpacingSize.Small) {
  return new SeparatorBuilder().setSpacing(spacing);
}

function container() {
  return new ContainerBuilder();
}

function button(customId, label, style, emoji) {
  const builder = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);

  if (emoji) builder.setEmoji(emoji);
  return builder;
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

module.exports = {
  button,
  container,
  row,
  separator,
  text
};
