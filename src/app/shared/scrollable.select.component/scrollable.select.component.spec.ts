import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScrollableSelectComponent } from './scrollable.select.component';

describe('ScrollableSelectComponent', () => {
  let component: ScrollableSelectComponent;
  let fixture: ComponentFixture<ScrollableSelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScrollableSelectComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ScrollableSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
