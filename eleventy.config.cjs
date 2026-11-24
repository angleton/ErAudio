module.exports = function (eleventyConfig) {
  eleventyConfig.addFilter('dateIso', (date) => new Date(date).toISOString().slice(0, 10));
  eleventyConfig.addFilter('dateDisplay', (date) => new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date));

  return {
    dir: {
      input: 'site',
      includes: '_includes',
      data: '_data',
      output: 'dist',
    },
    templateFormats: ['md', 'njk'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
};
