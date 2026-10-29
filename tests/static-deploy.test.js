import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source = resolve(fileURLToPath(new URL('..', import.meta.url)));
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'timemap-static-check-'));
  const env = {...process.env, GIT_AUTHOR_NAME:'Fixture', GIT_AUTHOR_EMAIL:'fixture@example.invalid', GIT_COMMITTER_NAME:'Fixture', GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git = (...args) => {
    const result = spawnSync('git', ['-C', path, ...args], {encoding:'utf8', env});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  for (const item of ['index.html','styles.css','manifest.webmanifest','sw.js','assets','js']) cpSync(join(source,item), join(path,item), {recursive:true});
  mkdirSync(join(path,'deploy'));
  cpSync(join(source,'deploy/check-static.py'), join(path,'deploy/check-static.py'));
  git('init','-q'); git('add','.'); git('commit','-qm','synthetic static fixture');
  const check = sha => spawnSync('python3', [join(path,'deploy/check-static.py'),'--expected-commit',sha], {encoding:'utf8'});
  return {path, git, check, cleanup:()=>rmSync(path,{recursive:true,force:true})};
}

test('固定前端检查只输出静态清单，不修改检出或包含Git及文档', () => {
  const f=fixture(); try {
    const sha=f.git('rev-parse','HEAD'); const result=f.check(sha);
    assert.equal(result.status,0,result.stderr);
    const inventory=JSON.parse(result.stdout);
    assert.equal(inventory.frontend_commit,sha);
    assert.equal(Object.keys(inventory.static_files).length,13);
    assert.ok(Object.keys(inventory.static_files).every(p=>!p.includes('.git')&&!p.startsWith('docs/')));
    assert.equal(f.git('status','--porcelain'),'');
  } finally {f.cleanup();}
});

test('Git检出干净但静态依赖缺失时仍拒绝部署', () => {
  const f=fixture(); try {
    f.git('rm','assets/icon-192.png');f.git('commit','-qm','remove required icon');
    const result=f.check(f.git('rev-parse','HEAD'));
    assert.notEqual(result.status,0);assert.match(result.stderr,/Missing/);
  } finally {f.cleanup();}
});

test('错误提交或未提交文件不会被当成已批准的前端版本', () => {
  const f=fixture(); try {
    assert.notEqual(f.check('0'.repeat(40)).status,0);
    const sha=f.git('rev-parse','HEAD');writeFileSync(join(f.path,'unexpected.txt'),'synthetic');
    const result=f.check(sha);assert.notEqual(result.status,0);assert.match(result.stderr,/untracked/);
  } finally {f.cleanup();}
});
