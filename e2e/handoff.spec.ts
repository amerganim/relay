import { expect, test, type Page } from '@playwright/test';

/** Let the built-in bot play the current leg to its end, then pick the first upgrade if one is offered. */
async function playLeg(page: Page): Promise<string> {
  await expect(page.locator('.hud.on')).toBeVisible();
  const phase = await page.evaluate(() =>
    (window as unknown as { __relay: { botPlay: () => string } }).__relay.botPlay(),
  );
  if (phase === 'upgrade') {
    const card = page.locator('.card').first();
    await expect(card).toBeVisible();
    // Cards ignore taps for a moment after the timer ends, so a stray thumb cannot pick one.
    await expect(page.locator('.overlay.locked')).toHaveCount(0);
    await card.click();
  }
  await expect(page.locator('.overlay.timeline')).toBeVisible();
  return phase;
}

test('two players complete a full handoff', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  // Alice starts a run, plays her minute and hands it on.
  await alice.goto('/');
  await alice.getByRole('button', { name: 'Start a new run' }).click();
  const alicePhase = await playLeg(alice);
  expect(alicePhase).toBe('upgrade');
  await expect(alice.locator('.leg')).toHaveCount(1);
  await expect(alice.locator('.leg.mine .leg-who')).toHaveText('You');
  await expect(alice.getByRole('heading')).toHaveText('Torch passed on');
  const floorAfterAlice = await alice.locator('.big').textContent();

  // Bob asks for a run and receives Alice's, exactly where she left it.
  await bob.goto('/');
  await bob.getByRole('button', { name: 'Carry a run' }).click();
  await expect(bob.locator('.hud-floor')).toHaveText(floorAfterAlice!);
  await expect(bob.locator('.hud-leg')).toHaveText('LEG 2');
  await playLeg(bob);

  // Bob sees both legs: Alice as an anonymous carrier, himself as "You".
  await expect(bob.locator('.leg')).toHaveCount(2);
  await expect(bob.locator('.leg').nth(0).locator('.leg-who')).toContainText('Carrier');
  await expect(bob.locator('.leg').nth(1).locator('.leg-who')).toHaveText('You');

  // Bob leaves a mark, and it shows up on his leg.
  await bob.locator('.emote').first().click();
  await expect(bob.locator('.leg').nth(1).locator('.leg-note')).toContainText('🔥');

  // Nothing is left behind to resume on either device.
  for (const page of [alice, bob]) {
    await page.reload();
    await expect(page.getByRole('button', { name: /Continue run/ })).toHaveCount(0);
  }
});

test('a share link opens a specific run, and a held run is locked to others', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  const carol = await (await browser.newContext()).newPage();

  await alice.goto('/');
  const started = alice.waitForResponse((r) => r.url().endsWith('/api/start'));
  await alice.getByRole('button', { name: 'Start a new run' }).click();
  const { runId } = (await (await started).json()) as { runId: string };
  await playLeg(alice);

  await bob.goto(`/?r=${runId}`);
  await bob.getByRole('button', { name: 'Take the torch' }).click();
  await expect(bob.locator('.hud-leg')).toHaveText('LEG 2');
  // The link is used up once the run is claimed.
  expect(new URL(bob.url()).search).toBe('');

  // Carol opens the same link while Bob is still carrying the run.
  await carol.goto(`/?r=${runId}`);
  await carol.getByRole('button', { name: 'Take the torch' }).click();
  await expect(carol.getByRole('heading')).toContainText('Someone is carrying this run');
});
