const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const stripAnsi = require('strip-ansi');
const { Octokit } = require("octokit");
const { env } = require('process');

require('dotenv').config()
const { GH_TOKEN, SKIP_NEO_TECHNOLOGY } = process.env;

const octokit = new Octokit({
  auth: GH_TOKEN
})

async function teardownDeploy(deploy) {
  try {
    const { stdout, stderr } = await exec(`surge teardown ${deploy}`);
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
  }catch (err) {
     console.error(err);
  };
}

async function surgeList() {
  try {
      const { stdout, stderr } = await exec('surge list');
      console.log('stdout:', stdout);
      // console.log('stderr:', stderr);

      const deploys = stripAnsi(stdout).split('\n');
    
      // const deploys = fs.readFileSync('deploys.txt','utf-8').split(/\r?\n|\r|\n/g);
    
      return deploys;
  }catch (err) {
     console.error(err);
  };
};

const getPRStatus = async(org, repo, prNumber) => {
    try {
        const { data } =  await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner: org,
          repo: repo,
          pull_number: prNumber,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        })
        return data.state;
    }catch (err) {
        console.error(err);
    };
}

surgeList().then((deploys) => {

  for (let deploy of deploys) {
    const deployDetails = deploy.replace(/[ \s\t]+/g,' ').trim().split(' ');

    // ge the deploy url
    const deployUrl = deployDetails[0];
    if (!deployUrl) continue;
    
    // derive the pr details from the deploy url
    const prDetails = deployUrl.replace('.surge.sh','').split(/[.-]/);
    const prNumber = prDetails.pop();
    if (isNaN(prNumber)) continue;

    const org = prDetails[0] === 'neo4j' ? 'neo4j' : prDetails.slice(0,2).join('-');

    // neo-technology is protected by SAML
    if (org === 'neo-technology' && SKIP_NEO_TECHNOLOGY) continue;

    const repo = prDetails.join('-').replace(org+'-','');
    // check the pr details to see if the pr is closed
    getPRStatus(org, repo, prNumber).then((prStatus) => {
      // if the pr is closed, teardown the deploy
      if (prStatus === 'closed') {
          console.log(`${deployUrl} - PR is closed, tearing down deploy`);
          teardownDeploy(deployDetails[0]);
      } else {
          // console.log(`${deployUrl} - PR is not closed`);
      }
    })
  }
});