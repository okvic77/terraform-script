import core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import fetch from "node-fetch";

async function getVariables(workspace, org, { TOKEN }) {
  const url = new URL("https://app.terraform.io/api/v2/vars");
  url.searchParams.append("filter[organization][name]", org);
  url.searchParams.append("filter[workspace][name]", workspace);
  const variables = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/vnd.api+json",
    },
  });

  return variables.json();
}

async function updateVariable(variable, newValue, workspace, org, { TOKEN }) {
  const url = new URL(`https://app.terraform.io/api/v2/vars/${variable.id}`);
  const variables = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/vnd.api+json",
    },
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "vars",
        id: variable.id,
        attributes: {
          ...variable.attributes,
          value: newValue,
        },
      },
    }),
  });

  return variables.json();
}

async function getWorkspace(workspace, org, { TOKEN }) {
  const url = new URL(
    `https://app.terraform.io/api/v2/organizations/${org}/workspaces/${workspace}`
  );
  const variables = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/vnd.api+json",
    },
  });

  return variables.json();
}

async function createRun(workspace, { TOKEN, message, autoApply = false }) {
  const url = new URL(`https://app.terraform.io/api/v2/runs`);
  const body = {
    data: {
      type: "runs",
      relationships: {
        workspace: {
          data: {
            type: "workspaces",
            id: workspace.id,
          },
        },
      },
      attributes: {
        "auto-apply": autoApply,
        message,
      },
    },
  };
  console.log("run body", JSON.stringify(body, null, 2));
  const variables = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/vnd.api+json",
    },
    method: "POST",
    body: JSON.stringify(body),
  });

  return variables.json();
}

async function run() {
  const githubToken = core.getInput("github-token");
  const { rest } = getOctokit(githubToken);

  const TOKEN = core.getInput("token");
  const workspacename = core.getInput("workspace");
  const organization = core.getInput("organization");
  const message = core.getInput("message");
  const commitMessage = core.getInput("commit-message") || "";
  const tag = core.getInput("tag");
  const autoApply = core.getInput("auto-apply") === "true";;

  const options = { TOKEN };

  const deplymentIssue = await rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title: `Deploying tag ${tag}`,
    body: `Deploying tag ${tag} to ${workspacename}.`,
    labels: ["deployment"],
    assignees: [context.actor],
  });

  const variables = await getVariables(workspacename, organization, options);
  const variableTag = variables.data.find((v) => v.attributes.key === "tag");

  if (variableTag) {
    await updateVariable(
      variableTag,
      tag,
      workspacename,
      organization,
      options
    );
    const infoComment = await rest.issues.createComment({
      issue_number: deplymentIssue.data.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: "Variable set on Terraform Cloud.",
    });

    const workspace = await getWorkspace(workspacename, organization, options);
    console.log("workspace", JSON.stringify(workspace, null, 2));

    // We auto aply only if the commit message contains [auto-apply]
    const run = await createRun(workspace.data, { ...options, message, autoApply });
    console.log("run", JSON.stringify(run, null, 2));
    // Update comment with run link
    await rest.issues.updateComment({
      comment_id: infoComment.data.id,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: `Variable set on Terraform Cloud. [Terraform Cloud Run](https://app.terraform.io/app/${organization}/workspaces/${workspacename}/runs/${run.data.id})`,
    });
  } else {
    await rest.issues.createComment({
      issue_number: deplymentIssue.data.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: "No variable tag found.",
    });
  }
}

run().catch((error) => {
  core.setFailed(error.message);
});
