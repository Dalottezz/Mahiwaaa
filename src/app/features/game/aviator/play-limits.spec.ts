import '@angular/compiler';
import { Location } from '@angular/common';
import { TestBed, getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/services/auth.service';
import { GameSocketService } from '../../../core/services/game-socket.service';
import { GameSoundService } from '../../../core/services/game-sound.service';
import { PLAY_LIMIT_MESSAGE } from '../../../core/config/play-limits';
import { AviatorGameComponent } from './aviator-game.component';

if (!getTestBed().platform) {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

describe('Wallet play limit', () => {
  let component: AviatorGameComponent;
  const gameSocket = { placeBet: vi.fn(), cashOut: vi.fn() };
  const auth = { updateBalance: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameSocketService, useValue: gameSocket },
        { provide: AuthService, useValue: auth },
        { provide: GameSoundService, useValue: { isEnabled: () => false } },
        { provide: Router, useValue: {} },
        { provide: Location, useValue: {} },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AviatorGameComponent());
    component.isConnected.set(true);
    component.hasCompletedFirstDeposit.set(true);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('allows play at exactly KES 500,000', () => {
    component.userBalance.set(500_000);
    component.room1.gameState.set('WAITING');
    component.placeBet(1);
    expect(component.isPlayLimited()).toBe(false);
    expect(gameSocket.placeBet).toHaveBeenCalled();
  });

  it('blocks both panels in all rooms above the limit without deducting funds', () => {
    component.userBalance.set(500_000.01);
    const toast = vi.spyOn(component, 'showToast');
    for (const roomId of [1, 2, 3]) {
      component.selectedRoom.set(roomId);
      for (const panel of [1, 2] as const) {
        component.placeBet(panel);
        component.queueBet(panel);
      }
    }
    expect(gameSocket.placeBet).not.toHaveBeenCalled();
    expect(component.userBalance()).toBe(500_000.01);
    expect(toast).toHaveBeenCalledWith(PLAY_LIMIT_MESSAGE, true);
  });

  it('clears queued and automatic bets across rooms when winnings cross the limit', () => {
    for (const room of [component.room1, component.room2, component.room3]) {
      for (const panel of [room.panel1, room.panel2]) {
        panel.update(p => ({ ...p, autoBetEnabled: true, queuedAmount: 100 }));
      }
    }
    component.room1.panel1.update(p => ({ ...p, hasActiveBet: true, placedAmount: 100 }));
    component.userBalance.set(500_001);
    TestBed.tick();
    for (const room of [component.room1, component.room2, component.room3]) {
      for (const panel of [room.panel1, room.panel2]) {
        expect(panel().queuedAmount).toBe(0);
        expect(panel().autoBetEnabled).toBe(false);
      }
    }
    expect(component.room1.panel1().hasActiveBet).toBe(true);
    expect(component.userBalance()).toBe(500_001);
  });

  it('rechecks a queued bet before sending it to the server', () => {
    component.room2.panel2.update(p => ({ ...p, queuedAmount: 100 }));
    component.userBalance.set(500_001);
    component.activateQueuedBet(2, 2);
    expect(gameSocket.placeBet).not.toHaveBeenCalled();
    expect(component.room2.panel2().queuedAmount).toBe(0);
  });

  it('still allows an existing bet to cash out above the limit', () => {
    component.userBalance.set(600_000);
    component.room1.gameState.set('RUNNING');
    component.room1.panel1.update(p => ({ ...p, hasActiveBet: true, placedAmount: 100 }));
    component.cashOut(1);
    expect(gameSocket.cashOut).toHaveBeenCalledWith(1, 1);
  });

  it('allows betting again after the wallet returns to the limit', () => {
    component.userBalance.set(600_000);
    expect(component.isPlayLimited()).toBe(true);
    component.userBalance.set(500_000);
    component.room1.gameState.set('WAITING');
    component.placeBet(2);
    expect(component.isPlayLimited()).toBe(false);
    expect(gameSocket.placeBet).toHaveBeenCalled();
  });
});
