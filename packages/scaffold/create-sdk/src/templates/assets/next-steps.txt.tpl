{{#if setupRequired}}
Next: cd {{directory}} && {{packageManager}} {{installArgs}} && {{packageManager}} {{buildArgs}} && {{packageManager}} start
{{else}}
Next: cd {{directory}} && {{packageManager}} start
{{/if}}
