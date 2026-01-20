import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BodyTypesComponent } from './body.types.component';

describe('BodyTypesComponent', () => {
  let component: BodyTypesComponent;
  let fixture: ComponentFixture<BodyTypesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BodyTypesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BodyTypesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
