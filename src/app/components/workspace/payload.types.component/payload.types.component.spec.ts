import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PayloadTypesComponent } from './payload.types.component';

describe('PayloadTypesComponent', () => {
  let component: PayloadTypesComponent;
  let fixture: ComponentFixture<PayloadTypesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PayloadTypesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PayloadTypesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
